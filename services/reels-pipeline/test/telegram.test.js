const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deliverReel,
  sendVideo,
  sendMessage,
  splitMessage,
  buildBrief,
  callApi,
  MESSAGE_LIMIT,
  VIDEO_SIZE_LIMIT,
} = require("../delivery/telegram");

const TOKEN = "123:test-token";

/** Перехватывает вызовы Bot API и отвечает успехом. */
function fakeApi(result = {}) {
  const calls = [];

  const fetchImpl = async (url, options) => {
    calls.push({ url, options, method: url.split("/").pop() });
    return { ok: true, json: async () => ({ ok: true, result }) };
  };

  return { calls, fetchImpl };
}

function reelFixture(overrides = {}) {
  return {
    trend: { title: "I Quit My Job After This", url: "https://youtube.test/1", niche: "money" },
    ru: { headline: "Заголовок", overlay: "Я УШЁЛ с работы", post: "Русский пост" },
    en: { overlay: "I QUIT my job", caption: "English caption" },
    checks: {
      overlay: { ok: true, problems: [] },
      overlayEn: { ok: true, problems: [] },
      post: { ok: true, problems: [] },
    },
    ...overrides,
  };
}

test("callApi не раскрывает токен в тексте ошибки", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ ok: false, description: "Unauthorized" }),
  });

  await assert.rejects(
    () => callApi({ token: TOKEN, method: "sendMessage", body: {}, fetchImpl }),
    (err) => {
      assert.ok(!err.message.includes(TOKEN), `токен утёк в ошибку: ${err.message}`);
      assert.match(err.message, /Unauthorized/);
      return true;
    }
  );
});

test("sendVideo не пытается загрузить файл сверх лимита Bot API", async () => {
  const { fetchImpl } = fakeApi();
  const huge = Buffer.alloc(VIDEO_SIZE_LIMIT + 1);

  await assert.rejects(
    () => sendVideo({ token: TOKEN, chatId: "1", video: huge, fetchImpl }),
    /50 МБ/
  );
});

test("splitMessage не теряет текст длиннее лимита", () => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `Абзац номер ${i} `.repeat(10));
  const text = paragraphs.join("\n\n");

  const chunks = splitMessage(text);

  assert.ok(chunks.length > 1, "длинный текст должен разбиться");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= MESSAGE_LIMIT, `кусок ${chunk.length} символов`);
  }
  // Ничего не потеряно: все абзацы на месте.
  const joined = chunks.join("\n\n");
  for (const paragraph of paragraphs) {
    assert.ok(joined.includes(paragraph.trim()), "абзац пропал при разбиении");
  }
});

test("splitMessage режет абзац, который сам длиннее лимита", () => {
  const chunks = splitMessage("а".repeat(MESSAGE_LIMIT * 2 + 5));

  assert.equal(chunks.length, 3);
  assert.equal(chunks.join("").length, MESSAGE_LIMIT * 2 + 5);
});

test("buildBrief выносит переполнение надписи в предупреждение", () => {
  const brief = buildBrief({ reel: reelFixture(), render: { overflow: true } });

  assert.match(brief, /⚠️/);
  assert.match(brief, /не влезла в кадр/);
});

test("buildBrief молчит, когда все проверки прошли", () => {
  const brief = buildBrief({ reel: reelFixture(), render: { overflow: false } });

  assert.ok(!brief.includes("⚠️"), brief);
  assert.match(brief, /I QUIT my job/);
});

test("buildBrief сообщает о непройденной проверке поста", () => {
  const reel = reelFixture({
    checks: {
      overlayEn: { ok: true, problems: [] },
      post: { ok: false, problems: ["пост короче 1700 символов (сейчас 900)"] },
    },
  });

  assert.match(buildBrief({ reel, render: {} }), /пост короче 1700/);
});

test("deliverReel отправляет видео и оба текста", async () => {
  const { calls, fetchImpl } = fakeApi({ message_id: 7 });

  await deliverReel({
    reel: reelFixture(),
    video: Buffer.from("mp4"),
    token: TOKEN,
    chatId: "42",
    render: { overflow: false },
    fetchImpl,
  });

  assert.deepEqual(
    calls.map((c) => c.method),
    ["sendVideo", "sendMessage", "sendMessage"]
  );

  const texts = calls.slice(1).map((c) => JSON.parse(c.options.body).text);
  assert.match(texts[0], /English caption/);
  assert.match(texts[1], /Русский пост/);
});

test("sendMessage выключает превью ссылок", async () => {
  const { calls, fetchImpl } = fakeApi();

  await sendMessage({ token: TOKEN, chatId: "42", text: "смотри https://youtube.test/1", fetchImpl });

  assert.equal(JSON.parse(calls[0].options.body).disable_web_page_preview, true);
});
