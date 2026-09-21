const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeViewsPerHour,
  normalizeTitle,
  titleSimilarity,
  dedupe,
  rank,
  selectTop,
} = require("../trends");
const { selectNiches, NICHES } = require("../niches");
const { buildSearchParams, toCandidate, chunk } = require("../sources/youtube");

const NOW = new Date("2026-09-21T12:00:00Z");

function candidate(overrides) {
  return {
    id: "x",
    source: "youtube",
    title: "Title",
    url: "https://example.test",
    niche: "money",
    views: 1000,
    publishedAt: "2026-09-21T06:00:00Z",
    ...overrides,
  };
}

test("computeViewsPerHour делит просмотры на возраст в часах", () => {
  const vph = computeViewsPerHour(60_000, "2026-09-21T06:00:00Z", NOW);
  assert.equal(vph, 10_000); // 60000 за 6 часов
});

test("computeViewsPerHour не делит на ноль для только что вышедшего ролика", () => {
  const vph = computeViewsPerHour(5_000, "2026-09-21T11:59:00Z", NOW);
  assert.equal(vph, 5_000); // возраст поджат до 1 часа
  assert.ok(Number.isFinite(vph));
});

test("computeViewsPerHour падает на некорректной дате", () => {
  assert.throws(() => computeViewsPerHour(100, "не дата", NOW), /Invalid publishedAt/);
});

test("normalizeTitle убирает эмодзи, пунктуацию и регистр", () => {
  assert.equal(normalizeTitle("I Quit My Job — After THIS!! 🔥"), "i quit my job after this");
});

test("titleSimilarity ловит переформулированный хук", () => {
  const a = "I Quit My Job After This Happened";
  const b = "She Quit Her Job After This Happened";
  assert.ok(titleSimilarity(a, b) >= 0.6, `similarity=${titleSimilarity(a, b)}`);
});

test("titleSimilarity различает разные темы", () => {
  const a = "How I Lost 40 Pounds Without The Gym";
  const b = "Make Money With AI While You Sleep";
  assert.ok(titleSimilarity(a, b) < 0.2);
});

test("rank сортирует по скорости, а не по сырым просмотрам", () => {
  const fresh = candidate({ id: "fresh", views: 50_000, publishedAt: "2026-09-21T11:00:00Z" });
  const older = candidate({ id: "older", views: 100_000, publishedAt: "2026-09-20T12:00:00Z" });

  const ranked = rank([older, fresh], NOW);
  assert.equal(ranked[0].id, "fresh"); // 50000/час против ~4167/час
});

test("rank не мутирует исходный массив", () => {
  const input = [candidate({ id: "a" }), candidate({ id: "b", views: 99_999 })];
  const copy = JSON.parse(JSON.stringify(input));
  rank(input, NOW);
  assert.deepEqual(input, copy);
});

test("dedupe отсекает кандидата, похожего на уже опубликованный", () => {
  const kept = dedupe(
    [candidate({ title: "She Quit Her Job After This Happened" })],
    ["I Quit My Job After This Happened"]
  );
  assert.equal(kept.length, 0);
});

test("dedupe отсекает похожих кандидатов внутри выборки", () => {
  const kept = dedupe([
    candidate({ id: "1", title: "How I Made $12,000 With AI" }),
    candidate({ id: "2", title: "How She Made $12,000 With AI" }),
    candidate({ id: "3", title: "Three Foods That Wreck Your Sleep" }),
  ]);
  assert.deepEqual(kept.map((c) => c.id), ["1", "3"]);
});

test("selectTop оставляет из группы повторов самый вирусный", () => {
  const slow = candidate({
    id: "slow",
    title: "How I Made Money With AI",
    views: 10_000,
    publishedAt: "2026-09-21T06:00:00Z",
  });
  const fast = candidate({
    id: "fast",
    title: "How She Made Money With AI",
    views: 90_000,
    publishedAt: "2026-09-21T06:00:00Z",
  });

  const top = selectTop([slow, fast], { now: NOW });
  assert.equal(top.length, 1);
  assert.equal(top[0].id, "fast");
});

test("selectTop обрезает до limit", () => {
  const titles = [
    "How I Made Money With AI",
    "Three Foods That Wreck Your Sleep",
    "Red Flags Nobody Warns You About",
    "The Morning Habit That Changed Everything",
    "What Toddlers Really Mean When They Scream",
  ];
  const many = titles.map((title, i) => candidate({ id: String(i), title }));

  assert.equal(selectTop(many, { limit: 3, now: NOW }).length, 3);
  // без limit проходят все пять — значит обрезал именно limit, а не дедупликация
  assert.equal(selectTop(many, { now: NOW }).length, 5);
});

test("selectNiches без фильтра возвращает все ниши", () => {
  assert.equal(selectNiches([]).length, NICHES.length);
});

test("selectNiches падает на неизвестном ключе, а не молча сужает выборку", () => {
  assert.throws(() => selectNiches(["money", "опечатка"]), /Unknown niche "опечатка"/);
});

test("buildSearchParams запрашивает короткие ролики внутри окна", () => {
  const params = buildSearchParams({
    query: "make money with ai",
    publishedAfter: "2026-09-20T12:00:00Z",
    apiKey: "KEY",
    opts: { perQuery: 25, regionCode: "US", relevanceLanguage: "en" },
  });

  assert.equal(params.get("videoDuration"), "short");
  assert.equal(params.get("order"), "viewCount");
  assert.equal(params.get("type"), "video");
  assert.equal(params.get("publishedAfter"), "2026-09-20T12:00:00Z");
  assert.equal(params.get("q"), "make money with ai");
});

test("toCandidate собирает ссылку на Shorts и числовые просмотры", () => {
  const mapped = toCandidate(
    {
      id: "abc123",
      snippet: {
        title: "Hook",
        publishedAt: "2026-09-21T10:00:00Z",
        channelTitle: "Some Channel",
      },
      statistics: { viewCount: "84000" },
    },
    "ai_income"
  );

  assert.equal(mapped.url, "https://www.youtube.com/shorts/abc123");
  assert.equal(mapped.views, 84_000);
  assert.equal(mapped.niche, "ai_income");
  assert.equal(mapped.source, "youtube");
});

test("toCandidate не роняется на ролике без статистики", () => {
  const mapped = toCandidate({ id: "z", snippet: {} }, "money");
  assert.equal(mapped.views, 0);
  assert.equal(mapped.title, "");
});

test("chunk режет идентификаторы по лимиту videos.list", () => {
  const ids = Array.from({ length: 120 }, (_, i) => i);
  const chunks = chunk(ids, 50);
  assert.deepEqual(chunks.map((c) => c.length), [50, 50, 20]);
});
