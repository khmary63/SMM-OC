const test = require("node:test");
const assert = require("node:assert/strict");

const { runPipeline } = require("../pipeline");
const { BACKGROUNDS_FOLDER_ID } = require("../sources/drive");

const NOW = new Date("2026-09-21T12:00:00Z");

function candidate(overrides = {}) {
  return {
    id: "vid1",
    source: "youtube",
    title: "I Quit My Job After This",
    url: "https://youtube.test/vid1",
    niche: "money",
    views: 60_000,
    publishedAt: "2026-09-21T06:00:00Z",
    ...overrides,
  };
}

/**
 * Пайплайн с подменёнными шагами: сеть не трогается, а каждый вызов
 * записывается, чтобы проверить, что именно ушло в следующий шаг.
 */
function harness(overrides = {}) {
  const seen = {};

  const steps = {
    fetchCandidates: async (args) => {
      seen.fetchCandidates = args;
      return { candidates: [candidate()], errors: [] };
    },
    fetchKnowledge: async (args) => {
      seen.fetchKnowledge = args;
      return { copywriter: "инструкция" };
    },
    listFolder: async (folderId, args) => {
      seen.listFolder = { folderId, args };
      return [
        { id: "bg1", name: "fresh.mp4", mimeType: "video/mp4" },
        { id: "bg2", name: "used.mp4", mimeType: "video/mp4" },
        { id: "doc", name: "инструкции", mimeType: "application/vnd.google-apps.folder" },
      ];
    },
    generateReel: async (args) => {
      seen.generateReel = args;
      return {
        trend: { title: args.trend.title, url: args.trend.url, niche: args.trend.niche },
        ru: { headline: "Заголовок", overlay: "Я УШЁЛ", post: "Русский пост" },
        en: { overlay: "I QUIT my job", caption: "English caption" },
        checks: { overlayEn: { ok: true }, post: { ok: true } },
      };
    },
    renderReel: async (args) => {
      seen.renderReel = args;
      return { video: Buffer.from("mp4-bytes"), jobId: "job-1", overflow: false, lines: 2 };
    },
    deliverReel: async (args) => {
      seen.deliverReel = args;
      return { message_id: 1 };
    },
    ...overrides,
  };

  return { steps, seen };
}

const BASE = {
  youtubeApiKey: "yt-key",
  googleAccessToken: "google-token",
  telegram: { token: "tg-token", chatId: "42" },
  render: { url: "http://worker.test", token: "render-token" },
  now: NOW,
  random: () => 0,
};

test("runPipeline проводит рилс от тренда до отправки", async () => {
  const { steps, seen } = harness();

  const result = await runPipeline({ ...BASE, steps });

  assert.equal(seen.generateReel.trend.title, "I Quit My Job After This");
  assert.equal(seen.deliverReel.chatId, "42");
  assert.equal(seen.deliverReel.video.toString(), "mp4-bytes");
  assert.equal(result.render.jobId, "job-1");
});

test("runPipeline кладёт на видео английскую надпись, а не русскую", async () => {
  const { steps, seen } = harness();

  await runPipeline({ ...BASE, steps });

  assert.equal(seen.renderReel.headline, "I QUIT my job");
});

test("runPipeline даёт рендеру авторизацию к приватной подложке Drive", async () => {
  const { steps, seen } = harness();

  await runPipeline({ ...BASE, steps });

  assert.equal(seen.listFolder.folderId, BACKGROUNDS_FOLDER_ID);
  assert.match(seen.renderReel.videoUrl, /files\/bg1\?alt=media/);
  assert.equal(seen.renderReel.videoHeaders.Authorization, "Bearer google-token");
});

test("runPipeline обходит подложку, использованную недавно", async () => {
  const { steps, seen } = harness();

  // bg1 занят вчера — при карантине в половину коллекции остаётся bg2.
  await runPipeline({ ...BASE, steps, usageLog: { bg1: "2026-09-20T12:00:00Z" } });

  assert.match(seen.renderReel.videoUrl, /files\/bg2\?alt=media/);
});

test("runPipeline возвращает состояние для следующего запуска", async () => {
  const { steps } = harness();

  const result = await runPipeline({ ...BASE, steps, usageLog: { bg2: "2026-09-01T00:00:00Z" } });

  assert.equal(result.publishedTitle, "I Quit My Job After This");
  assert.equal(result.usageLog.bg1, NOW.toISOString());
  assert.equal(result.usageLog.bg2, "2026-09-01T00:00:00Z", "чужие записи не теряются");
});

test("runPipeline не публикует хук, который уже был", async () => {
  const { steps, seen } = harness();

  await assert.rejects(
    () =>
      runPipeline({
        ...BASE,
        steps,
        publishedTitles: ["She Quit Her Job After This"],
      }),
    /после отбора ноль/
  );

  assert.equal(seen.generateReel, undefined, "генерация не должна запускаться");
  assert.equal(seen.deliverReel, undefined, "отправка не должна запускаться");
});

test("runPipeline не молчит, когда ниша отвалилась", async () => {
  const logged = [];
  const { steps } = harness({
    fetchCandidates: async () => ({
      candidates: [candidate()],
      errors: [{ niche: "health", error: "quota exceeded" }],
    }),
  });

  await runPipeline({ ...BASE, steps, log: (m) => logged.push(m) });

  assert.ok(
    logged.some((m) => m.includes("health") && m.includes("quota exceeded")),
    logged.join("\n")
  );
});

test("runPipeline падает, если в папке Drive нет ни одного видео", async () => {
  const { steps } = harness({
    listFolder: async () => [{ id: "x", name: "инструкции", mimeType: "application/vnd.google-apps.folder" }],
  });

  await assert.rejects(() => runPipeline({ ...BASE, steps }), /No background videos/);
});
