const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateReel,
  parseHeadline,
  validatePost,
  validateOverlay,
  hasCapsWord,
  generateWithRetry,
  POST_MIN_CHARS,
  POST_MAX_CHARS,
  OVERLAY_MAX_CHARS,
} = require("../generate");
const { config, assertAsciiKey } = require("../llm");

const KNOWLEDGE = {
  copywriter: "ПРАВИЛА КОПИРАЙТЕРА",
  translator: "ПРАВИЛА ПЕРЕВОДЧИКА",
  toneOfVoice: "ПРИМЕРЫ ГОЛОСА",
  headlines: "ПРАВИЛА ЗАГОЛОВКОВ",
  headlineExamples: "ПРИМЕРЫ ЗАГОЛОВКОВ",
};

const TREND = {
  title: "I Quit My Job After This",
  url: "https://www.youtube.com/shorts/x",
  niche: "money",
};

function postOfLength(n) {
  return "а".repeat(n);
}

test("hasCapsWord находит слово капсом и не путает с обычным", () => {
  assert.equal(hasCapsWord("Эти три испытания не пройдёт НИ ОДИН нарцисс"), true);
  assert.equal(hasCapsWord("Не давай второй шанс (проверь его):"), false);
  assert.equal(hasCapsWord("5 БЕЗУМНЫХ советов от врачей"), true);
});

test("hasCapsWord не считает капсом одиночную заглавную в начале", () => {
  assert.equal(hasCapsWord("Почему ты не можешь отпустить"), false);
});

test("validatePost ловит недобор и перебор длины", () => {
  assert.equal(validatePost(postOfLength(1800)).ok, true);
  assert.match(validatePost(postOfLength(1500)).problems[0], /короче 1700/);
  assert.match(validatePost(postOfLength(2100)).problems[0], /длиннее 1900/);
});

test("validatePost принимает ровно граничные значения", () => {
  assert.equal(validatePost(postOfLength(POST_MIN_CHARS)).ok, true);
  assert.equal(validatePost(postOfLength(POST_MAX_CHARS)).ok, true);
});

test("validateOverlay бракует слишком длинную надпись", () => {
  const long = "СЛОВО " + "длинная надпись ".repeat(10);
  const check = validateOverlay(long);
  assert.equal(check.ok, false);
  assert.match(check.problems.join(" "), /нечитаемой/);
});

test("validateOverlay требует слово капсом", () => {
  assert.match(validateOverlay("обычная надпись без выделения").problems.join(" "), /капсом/);
  assert.equal(validateOverlay("Эта привычка УБИВАЕТ твой сон").ok, true);
});

test("validateOverlay бракует пустую надпись", () => {
  assert.match(validateOverlay("   ").problems.join(" "), /пустая/);
});

test("parseHeadline разбирает ответ на заголовок и надпись", () => {
  const parsed = parseHeadline(
    "HEADLINE: Длинный заголовок для подписи (проверь себя):\nOVERLAY: Эта привычка УБИВАЕТ твой сон"
  );
  assert.equal(parsed.headline, "Длинный заголовок для подписи (проверь себя):");
  assert.equal(parsed.overlay, "Эта привычка УБИВАЕТ твой сон");
  assert.equal(parsed.overlayCheck.ok, true);
});

test("parseHeadline падает, если модель проигнорировала формат", () => {
  assert.throws(() => parseHeadline("Вот твой заголовок: что-то там"), /без HEADLINE\/OVERLAY/);
});

test("generateWithRetry перезапрашивает и сообщает модели, что не так", async () => {
  const prompts = [];
  let call = 0;
  const llm = async (_system, user) => {
    prompts.push(user);
    return call++ === 0 ? postOfLength(1000) : postOfLength(1800);
  };

  const result = await generateWithRetry({
    system: "s",
    user: "u",
    validate: validatePost,
    maxTokens: 100,
    llm,
  });

  assert.equal(result.check.ok, true);
  assert.equal(result.attempts, 2);
  assert.match(prompts[1], /короче 1700/, "модели не сказали, что именно не так");
});

test("generateWithRetry сдаётся после лимита, но помечает результат невалидным", async () => {
  const llm = async () => postOfLength(100);
  const result = await generateWithRetry({
    system: "s",
    user: "u",
    validate: validatePost,
    maxTokens: 100,
    llm,
  });

  assert.equal(result.check.ok, false, "невалидный текст выдан за валидный");
  assert.equal(result.attempts, 3);
});

test("generateReel проходит все шаги и не копирует заголовок тренда", async () => {
  const seen = [];
  const llm = async (system, user) => {
    seen.push({ system, user });
    if (user.includes("HEADLINE:")) {
      return "HEADLINE: Свой заголовок про деньги (проверь себя):\nOVERLAY: Эта ошибка СЖИРАЕТ твою зарплату";
    }
    if (user.includes("Переведи на английский")) {
      return user.includes("надпись")
        ? "This mistake EATS your paycheck"
        : "Translated caption text";
    }
    return postOfLength(1800);
  };

  const reel = await generateReel({ trend: TREND, knowledge: KNOWLEDGE, llm });

  assert.equal(reel.ru.overlay, "Эта ошибка СЖИРАЕТ твою зарплату");
  assert.equal(reel.en.overlay, "This mistake EATS your paycheck");
  assert.equal(reel.en.caption, "Translated caption text");
  assert.equal(reel.checks.post.ok, true);
  assert.equal(reel.trend.url, TREND.url);

  const headlinePrompt = seen[0].user;
  assert.match(headlinePrompt, /НЕ копируй/, "модель не предупредили о копировании тренда");
  assert.match(headlinePrompt, new RegExp(TREND.title), "тема тренда не передана");
});

test("generateReel подставляет базы знаний в системные промпты", async () => {
  const systems = [];
  const llm = async (system, user) => {
    systems.push(system);
    if (user.includes("HEADLINE:")) return "HEADLINE: Заголовок ТУТ:\nOVERLAY: Короткая НАДПИСЬ";
    if (user.includes("Переведи на английский")) return "Translated";
    return postOfLength(1800);
  };

  await generateReel({ trend: TREND, knowledge: KNOWLEDGE, llm });

  assert.match(systems[0], /ПРАВИЛА ЗАГОЛОВКОВ/);
  assert.match(systems[0], /ПРИМЕРЫ ЗАГОЛОВКОВ/);
  assert.match(systems[1], /ПРАВИЛА КОПИРАЙТЕРА/);
  assert.match(systems[1], /ПРИМЕРЫ ГОЛОСА/, "tone of voice не попал в промпт");
  assert.match(systems[2], /ПРАВИЛА ПЕРЕВОДЧИКА/);
});

test("generateReel проверяет и английскую надпись, а не только русскую", async () => {
  const llm = async (system, user) => {
    if (user.includes("HEADLINE:")) return "HEADLINE: Заголовок ТУТ:\nOVERLAY: Короткая НАДПИСЬ";
    if (user.includes("Переведи на английский")) {
      // перевод раздулся и потерял капс — на видео это уже нечитаемо
      return user.includes("надпись") ? "a very long translated overlay ".repeat(5) : "caption";
    }
    return postOfLength(1800);
  };

  const reel = await generateReel({ trend: TREND, knowledge: KNOWLEDGE, llm });

  assert.equal(reel.checks.overlay.ok, true);
  assert.equal(reel.checks.overlayEn.ok, false, "раздутый перевод прошёл проверку");
  assert.ok(reel.checks.overlayEn.chars > OVERLAY_MAX_CHARS);
});

test("config берёт провайдера и модель из окружения", () => {
  const cfg = config({ AI_PROVIDER: "OpenAI", AI_MODEL: "some-model", AI_API_KEY: " k " });
  assert.equal(cfg.provider, "openai");
  assert.equal(cfg.model, "some-model");
  assert.equal(cfg.apiKey, "k");
});

test("config по умолчанию идёт в anthropic", () => {
  assert.equal(config({}).provider, "anthropic");
});

test("assertAsciiKey ловит кириллицу в ключе", () => {
  // с — кириллическая «с», от латинской "c" глазами не отличить,
  // а fetch на таком заголовке падает невнятно. Задаём кодом, а не символом.
  assert.throws(() => assertAsciiKey("sk-ant-api03-сbc", "AI_API_KEY"), /не-латинский/);
  assert.doesNotThrow(() => assertAsciiKey("sk-ant-api03-abc", "AI_API_KEY"));
});
