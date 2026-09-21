/**
 * Источник трендов на YouTube Data API v3.
 *
 * Отдаёт вирусные Shorts англоязычной аудитории за последние сутки в формате
 * TrendCandidate (см. trends.js). Заголовки Shorts и Reels в наших тематиках
 * пересекаются почти полностью, поэтому как источник хуков YouTube работает
 * не хуже Instagram, а данные отдаёт честно и бесплатно.
 *
 * Запрос двухшаговый: search.list не возвращает статистику, поэтому просмотры
 * добираются отдельным videos.list. Квота: search.list стоит 100 единиц,
 * videos.list — 1, при дневном лимите 10 000. Девять ниш дважды в сутки
 * укладываются примерно в 1 800 единиц.
 */

const { selectNiches } = require("../niches");

const API_BASE = "https://youtube.googleapis.com/youtube/v3";

/** videos.list принимает не больше 50 идентификаторов за вызов. */
const VIDEOS_BATCH_SIZE = 50;

const DEFAULTS = {
  windowHours: 24,
  perQuery: 25,
  minViews: 20_000,
  regionCode: "US",
  relevanceLanguage: "en",
};

/**
 * Параметры search.list для одного запроса.
 *
 * videoDuration=short ограничивает выдачу роликами до 4 минут — это и есть
 * Shorts. order=viewCount вместе с publishedAfter даёт самые просматриваемые
 * ролики именно внутри окна, а не за всё время.
 */
function buildSearchParams({ query, publishedAfter, apiKey, opts }) {
  return new URLSearchParams({
    key: apiKey,
    part: "snippet",
    q: query,
    type: "video",
    videoDuration: "short",
    order: "viewCount",
    publishedAfter,
    maxResults: String(opts.perQuery),
    regionCode: opts.regionCode,
    relevanceLanguage: opts.relevanceLanguage,
  });
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Идентификаторы роликов по одному поисковому запросу. */
async function searchVideoIds({ query, publishedAfter, apiKey, opts }) {
  const params = buildSearchParams({ query, publishedAfter, apiKey, opts });
  const data = await apiGet(`${API_BASE}/search?${params}`);

  return (data.items || [])
    .map((item) => item.id?.videoId)
    .filter(Boolean);
}

/** Разбивает массив на куски по size элементов. */
function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Статистика и сниппеты роликов по идентификаторам. */
async function fetchVideoDetails(ids, apiKey) {
  const details = [];

  for (const batch of chunk(ids, VIDEOS_BATCH_SIZE)) {
    const params = new URLSearchParams({
      key: apiKey,
      part: "snippet,statistics",
      id: batch.join(","),
    });
    const data = await apiGet(`${API_BASE}/videos?${params}`);
    details.push(...(data.items || []));
  }

  return details;
}

/** Приводит ответ videos.list к TrendCandidate. */
function toCandidate(video, niche) {
  return {
    id: video.id,
    source: "youtube",
    title: video.snippet?.title || "",
    url: `https://www.youtube.com/shorts/${video.id}`,
    niche,
    views: Number(video.statistics?.viewCount || 0),
    publishedAt: video.snippet?.publishedAt,
    channel: video.snippet?.channelTitle,
  };
}

/**
 * Собирает кандидатов по всем нишам.
 *
 * Ошибка в одной нише не роняет весь сбор: источников запросов много,
 * а пропущенная ниша — это меньше кандидатов, но не пустой прогон.
 * Что именно отвалилось, возвращается в errors для лога.
 */
async function fetchCandidates({
  apiKey = process.env.YOUTUBE_API_KEY,
  niches = [],
  now = new Date(),
  ...overrides
} = {}) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is required");

  const opts = { ...DEFAULTS, ...overrides };
  const publishedAfter = new Date(
    now.getTime() - opts.windowHours * 3_600_000
  ).toISOString();

  const candidates = [];
  const errors = [];

  for (const niche of selectNiches(niches)) {
    try {
      const ids = new Set();
      for (const query of niche.queries) {
        for (const id of await searchVideoIds({ query, publishedAfter, apiKey, opts })) {
          ids.add(id);
        }
      }

      if (ids.size === 0) continue;

      const videos = await fetchVideoDetails([...ids], apiKey);
      for (const video of videos) {
        const candidate = toCandidate(video, niche.key);
        if (candidate.publishedAt && candidate.views >= opts.minViews) {
          candidates.push(candidate);
        }
      }
    } catch (err) {
      errors.push({ niche: niche.key, error: err.message });
    }
  }

  return { candidates, errors };
}

module.exports = {
  fetchCandidates,
  buildSearchParams,
  toCandidate,
  chunk,
  DEFAULTS,
  API_BASE,
};
