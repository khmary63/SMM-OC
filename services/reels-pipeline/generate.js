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
 * Бюджет надписи на видео. Цифры не выдуманы — замерены прогоном реального
 * раскладчика из services/video-worker/reel.js на кадре 1080×1920:
 * до 100 символов текст укладывается в четыре строки, со 105 уходит в пять.
 *
 * Четыре строки — предел, две — цель: чем короче надпись, тем крупнее кегль
 * и тем лучше она читается в ленте.
 *
 * Проверка здесь предварительная, чтобы не тратить рендер впустую. Последнее
 * слово за самим рендером: он возвращает фактическое число строк и флаг
 * overflow, и это авторитетнее оценки по символам.
 */
const OVERLAY_MAX_CHARS = 100;

/** До этой длины надпись укладывается в одну-две строки самым крупным кеглем. */
const OVERLAY_COMPACT_CHARS = 30;

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

/**
 * Проверяет надпись, которая ляжет на видео.
 *
 * `ok` — жёсткий предел: за ним надпись не влезает в четыре строки.
 * `compact` — пожелание: надпись укладывается в одну-две строки.
 * Длинная, но валидная надпись публикуется, просто более мелким кеглем.
 */
function validateOverlay(text) {
  const chars = countChars(text);
  const problems = [];

  if (chars === 0) problems.push("надпись пустая");
  if (chars > OVERLAY_MAX_CHARS) {
    problems.push(
      `надпись длиннее ${OVERLAY_MAX_CHARS} символов (сейчас ${chars}) — ` +
        "не влезет в четыре строки"
    );
  }
  if (!hasCapsWord(text)) problems.push("нет слова капсом");

  return {
    ok: problems.length === 0,
    compact: chars > 0 && chars <= OVERLAY_COMPACT_CHARS,
    problems,
    chars,
  };
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
    `OVERLAY: та же мысль как надпись на видео — до ${OVERLAY_COMPACT_CHARS} символов, ` +
      `жёсткий предел ${OVERLAY_MAX_CHARS}. Чем короче, тем крупнее шрифт на кадре. ` +
      "Одна строка, со словом капсом, без потери провокации.",
  ].join("\n");

  let parsed = parseHeadline(await llm(system, user, { maxTokens: 500, ...options }));

  // Надпись за пределом или просто длинная — одна попытка сжать.
  // Дальше не давим: укоротить можно и ценой смысла, а это хуже мелкого шрифта.
  if (!parsed.overlayCheck.ok || !parsed.overlayCheck.compact) {
    const retry = [
      user,
      "",
      `Предыдущая надпись была на ${parsed.overlayCheck.chars} символов: «${parsed.overlay}».`,
      `Сожми её до ${OVERLAY_COMPACT_CHARS} символов, сохранив провокацию и слово капсом.`,
      "HEADLINE оставь прежним.",
    ].join("\n");

    const second = parseHeadline(await llm(system, retry, { maxTokens: 500, ...options }));
    // Берём вторую версию, только если она действительно лучше.
    if (second.overlayCheck.ok && second.overlayCheck.chars < parsed.overlayCheck.chars) {
      parsed = { ...second, headline: parsed.headline };
    }
  }

  return parsed;
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
  OVERLAY_COMPACT_CHARS,
};
