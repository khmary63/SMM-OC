/**
 * Генерация контента рилса: заголовок → пост → перевод на английский.
 *
 * Тренд из YouTube служит темой и подтверждением, что она сейчас заходит.
 * Сам заголовок пишется по «Мастеру заголовков», а не копируется из тренда:
 * чужой вирусный заголовок алгоритм уже видел, и голос бренда в нём теряется.
 *
 * Все инструкции приходят из Drive (см. sources/drive.js) и подставляются
 * в промпты как есть — правки в документах применяются без деплоя.
 */

const { chat } = require("./llm");

/** Пост в Instagram — до 2200 символов; инструкция требует 1700–1900. */
const POST_MIN_CHARS = 1700;
const POST_MAX_CHARS = 1900;

/**
 * Бюджет надписи на видео. Рендер подбирает кегль сам, но на трёх строках
 * при 1080×1920 читаемым остаётся примерно столько символов; дальше текст
 * мельчает до нечитаемого в ленте.
 */
const OVERLAY_MAX_CHARS = 90;

const RETRIES = 2;

function countChars(text) {
  return String(text).trim().length;
}

/** Есть ли в заголовке слово капсом — единственное правило, которое держится во всех примерах. */
function hasCapsWord(text) {
  return /(^|\s)[\p{Lu}]{2,}(\s|$|[),:.!?])/u.test(String(text));
}

/**
 * Проверяет пост по правилам, которые можно проверить машинно.
 * Остальные 20+ критериев — дело промпта, кодом их не измерить.
 */
function validatePost(text) {
  const chars = countChars(text);
  const problems = [];

  if (chars < POST_MIN_CHARS) {
    problems.push(`пост короче ${POST_MIN_CHARS} символов (сейчас ${chars})`);
  }
  if (chars > POST_MAX_CHARS) {
    problems.push(`пост длиннее ${POST_MAX_CHARS} символов (сейчас ${chars})`);
  }

  return { ok: problems.length === 0, problems, chars };
}

/** Проверяет надпись, которая ляжет на видео. */
function validateOverlay(text) {
  const chars = countChars(text);
  const problems = [];

  if (chars === 0) problems.push("надпись пустая");
  if (chars > OVERLAY_MAX_CHARS) {
    problems.push(
      `надпись длиннее ${OVERLAY_MAX_CHARS} символов (сейчас ${chars}) — ` +
        "на видео станет нечитаемой"
    );
  }
  if (!hasCapsWord(text)) problems.push("нет слова капсом");

  return { ok: problems.length === 0, problems, chars };
}

/**
 * Запрашивает модель, пока результат не пройдёт проверку.
 *
 * Инструкции Марии строгие (длина поста, капс, формат), а модели на них
 * стабильно промахиваются на десятки символов. Один повтор с явным указанием
 * промаха дешевле, чем ручная правка каждого поста.
 */
async function generateWithRetry({ system, user, validate, maxTokens, llm, options }) {
  let lastResult = "";
  let lastCheck = { ok: false, problems: ["не было ни одной попытки"] };

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nПредыдущая попытка не подошла: ${lastCheck.problems.join("; ")}. ` +
          `Исправь ровно это, остальное сохрани. Верни только итоговый текст.`;

    lastResult = (await llm(system, prompt, { maxTokens, ...options })).trim();
    lastCheck = validate(lastResult);
    if (lastCheck.ok) return { text: lastResult, check: lastCheck, attempts: attempt + 1 };
  }

  // Отдаём лучшее, что получилось, но с флагом — решение принимает вызывающий,
  // молча публиковать невалидный текст нельзя.
  return { text: lastResult, check: lastCheck, attempts: RETRIES + 1 };
}

/**
 * Шаг 1 — заголовок и надпись на видео.
 *
 * Надпись отделена от заголовка намеренно: заголовки в базе Марии написаны
 * для шапки поста, они длинные и многострочные. Поверх видео такой текст
 * приходится мельчить до нечитаемого, поэтому модель отдаёт две версии —
 * полную в подпись и короткую на кадр.
 */
async function generateHeadline({ trend, knowledge, llm = chat, options }) {
  const system = [
    knowledge.headlines,
    "\n\nПримеры заголовков в нужном голосе:\n",
    knowledge.headlineExamples,
  ].join("");

  const user = [
    `Тема взята из вирусного ролика: «${trend.title}».`,
    "Заголовок НЕ копируй — напиши свой по правилам выше на ту же тему.",
    "",
    "Верни ровно две строки без пояснений:",
    "HEADLINE: полный заголовок для подписи к посту",
    `OVERLAY: та же мысль как надпись на видео, до ${OVERLAY_MAX_CHARS} символов, одна строка, со словом капсом`,
  ].join("\n");

  const raw = await llm(system, user, { maxTokens: 500, ...options });
  return parseHeadline(raw);
}

/** Разбирает ответ модели на заголовок и надпись. */
function parseHeadline(raw) {
  const text = String(raw);
  const headline = text.match(/HEADLINE:\s*(.+)/i)?.[1]?.trim() || "";
  const overlay = text.match(/OVERLAY:\s*(.+)/i)?.[1]?.trim() || "";

  if (!headline || !overlay) {
    throw new Error(
      `Модель вернула ответ без HEADLINE/OVERLAY: ${text.slice(0, 200)}`
    );
  }

  return { headline, overlay, overlayCheck: validateOverlay(overlay) };
}

/** Шаг 2 — пост по инструкции копирайтера, в голосе из Tone of voice. */
async function generatePost({ headline, knowledge, llm = chat, options }) {
  const system = [
    knowledge.copywriter,
    "\n\nПримеры текстов в нужном голосе — держи эту интонацию:\n",
    knowledge.toneOfVoice,
  ].join("");

  const user = `Заголовок: ${headline}\n\nНапиши пост по правилам выше. Верни только текст поста вместе с заголовком.`;

  return generateWithRetry({
    system,
    user,
    validate: validatePost,
    maxTokens: 2000,
    llm,
    options,
  });
}

/** Шаг 3 — перевод на нативный английский по скиллу переводчика. */
async function translate({ text, contentType, knowledge, llm = chat, options }) {
  const user = [
    `Тип контента: ${contentType}.`,
    "Переведи на английский по правилам выше.",
    "Верни только переведённый текст, без Adaptation Notes.",
    "",
    text,
  ].join("\n");

  const result = await llm(knowledge.translator, user, { maxTokens: 2000, ...options });
  return String(result).trim();
}

/**
 * Полный цикл генерации для одного рилса.
 * Возвращает всё, что нужно рендеру и подписи, вместе с отчётом о проверках.
 */
async function generateReel({ trend, knowledge, llm = chat, options }) {
  const { headline, overlay, overlayCheck } = await generateHeadline({
    trend,
    knowledge,
    llm,
    options,
  });

  const post = await generatePost({ headline, knowledge, llm, options });

  const [overlayEn, postEn] = await Promise.all([
    translate({ text: overlay, contentType: "надпись на видео в рилсе", knowledge, llm, options }),
    translate({ text: post.text, contentType: "подпись к рилсу в Instagram", knowledge, llm, options }),
  ]);

  return {
    trend: { title: trend.title, url: trend.url, niche: trend.niche },
    ru: { headline, overlay, post: post.text },
    en: { overlay: overlayEn, caption: postEn },
    checks: {
      overlay: overlayCheck,
      overlayEn: validateOverlay(overlayEn),
      post: post.check,
      postAttempts: post.attempts,
    },
  };
}

module.exports = {
  generateReel,
  generateHeadline,
  generatePost,
  translate,
  parseHeadline,
  validatePost,
  validateOverlay,
  hasCapsWord,
  generateWithRetry,
  POST_MIN_CHARS,
  POST_MAX_CHARS,
  OVERLAY_MAX_CHARS,
  RETRIES,
};
