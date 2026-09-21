/**
 * Полный цикл одного рилса: тренд → тексты → подложка → рендер → Telegram.
 *
 * Шаги до этого были самостоятельными модулями и запускались по отдельности.
 * Здесь они соединены в один проход, рассчитанный на слот расписания: одно
 * срабатывание — один готовый рилс в боте у Марии.
 *
 * Модуль не лезет в process.env и не пишет на диск: ключи и состояние
 * приходят параметрами, наружу возвращается отчёт. За окружение и хранение
 * отвечает bin/run.js, за расписание — n8n.
 */

const { fetchCandidates } = require("./sources/youtube");
const { selectTop } = require("./trends");
const drive = require("./sources/drive");
const { generateReel } = require("./generate");
const { renderReel } = require("./render");
const { deliverReel } = require("./delivery/telegram");

/** Реальные реализации шагов; тесты подменяют их целиком. */
const DEFAULT_STEPS = {
  fetchCandidates,
  fetchKnowledge: drive.fetchKnowledge,
  listFolder: drive.listFolder,
  generateReel,
  renderReel,
  deliverReel,
};

/**
 * Выбирает хук дня.
 *
 * publishedTitles — заголовки за последние дни: без них дедупликация
 * защищает только внутри одной выборки, и через сутки тот же вирусный хук
 * спокойно приходит повторно.
 */
async function pickTrend({ steps, youtubeApiKey, niches, windowHours, publishedTitles, log }) {
  const { candidates, errors } = await steps.fetchCandidates({
    apiKey: youtubeApiKey,
    niches,
    windowHours,
  });

  for (const { niche, error } of errors) {
    log(`[warn] ниша ${niche}: ${error}`);
  }

  const [trend] = selectTop(candidates, { publishedTitles, limit: 1 });
  if (!trend) {
    throw new Error(
      `Не из чего выбирать: ${candidates.length} кандидатов, после отбора ноль. ` +
        "Проверьте квоту YouTube, порог minViews и историю публикаций."
    );
  }

  log(`Хук: «${trend.title}» (${Math.round(trend.viewsPerHour)} просмотров/час)`);
  return trend;
}

/** Подложка из Drive с учётом карантина недавно использованных. */
async function pickBackground({ steps, googleAccessToken, usageLog, random, log }) {
  const files = await steps.listFolder(drive.BACKGROUNDS_FOLDER_ID, {
    accessToken: googleAccessToken,
  });

  const background = drive.pickBackground(drive.selectBackgrounds(files), usageLog, random);
  log(`Подложка: ${background.name}`);

  return background;
}

/**
 * Один рилс от тренда до сообщения в Telegram.
 *
 * Порядок шагов обязателен, но тексты и подложка друг от друга не зависят,
 * поэтому Drive читается параллельно с генерацией — это экономит секунды
 * на каждом слоте и ничего не усложняет.
 *
 * @returns {Promise<{trend, reel, background, render, usageLog, publishedTitle}>}
 */
async function runPipeline({
  youtubeApiKey,
  googleAccessToken,
  telegram,
  render,
  niches = [],
  windowHours = 24,
  publishedTitles = [],
  usageLog = {},
  now = new Date(),
  random = Math.random,
  steps = DEFAULT_STEPS,
  log = () => {},
}) {
  const trend = await pickTrend({
    steps,
    youtubeApiKey,
    niches,
    windowHours,
    publishedTitles,
    log,
  });

  const [knowledge, background] = await Promise.all([
    steps.fetchKnowledge({ accessToken: googleAccessToken }),
    pickBackground({ steps, googleAccessToken, usageLog, random, log }),
  ]);

  log("Пишу тексты…");
  const reel = await steps.generateReel({ trend, knowledge });

  log("Рендерю видео…");
  const rendered = await steps.renderReel({
    baseUrl: render.url,
    token: render.token,
    videoUrl: drive.downloadUrl(background.id),
    videoHeaders: { Authorization: `Bearer ${googleAccessToken}` },
    // На кадр идёт английская надпись: лента англоязычная, русский текст
    // там был бы нечитаемым для аудитории, под которую отбирался хук.
    headline: reel.en.overlay,
  });

  log(`Отправляю в Telegram (${Math.round(rendered.video.length / 1024)} КБ)…`);
  await steps.deliverReel({
    reel,
    video: rendered.video,
    token: telegram.token,
    chatId: telegram.chatId,
    render: rendered,
  });

  return {
    trend,
    reel,
    background,
    render: { jobId: rendered.jobId, overflow: rendered.overflow, lines: rendered.lines },
    // Состояние для следующего запуска: что опубликовали и какую подложку заняли.
    publishedTitle: trend.title,
    usageLog: { ...usageLog, [background.id]: now.toISOString() },
  };
}

module.exports = { runPipeline, pickTrend, pickBackground, DEFAULT_STEPS };
