/**
 * Отбор вирусного хука: ранжирование и дедупликация кандидатов.
 *
 * Модуль намеренно ничего не знает про источник. Источник — это объект
 * с методом fetchCandidates(), возвращающий кандидатов единого формата,
 * поэтому YouTube можно заменить на любой другой сервис, не трогая отбор.
 *
 * @typedef {Object} TrendCandidate
 * @property {string} id            идентификатор в пределах источника
 * @property {string} source        "youtube", "trendsee", ...
 * @property {string} title         заголовок-хук
 * @property {string} url
 * @property {string} niche         ключ ниши из niches.js
 * @property {number} views
 * @property {string} publishedAt   ISO-8601
 * @property {string} [channel]
 */

/** Ролик моложе этого возраста ещё не набрал показательной статистики. */
const MIN_AGE_HOURS = 1;

/**
 * Скорость набора просмотров — просмотры в час с момента публикации.
 *
 * В окне 24 часа это честнее сырых просмотров: ролик, вышедший час назад
 * с 50 тысячами, вируснее вчерашнего с сотней тысяч. Возраст снизу
 * ограничен MIN_AGE_HOURS, иначе свежий ролик даёт бесконечную скорость.
 */
function computeViewsPerHour(views, publishedAt, now = new Date()) {
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    throw new Error(`Invalid publishedAt: ${publishedAt}`);
  }

  const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
  return Number(views) / Math.max(ageHours, MIN_AGE_HOURS);
}

/**
 * Приводит заголовок к виду, пригодному для сравнения: нижний регистр,
 * без эмодзи, пунктуации и кратных пробелов.
 */
function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Значимые слова заголовка: короткие служебные выкидываем. */
function titleTokens(title) {
  return new Set(normalizeTitle(title).split(" ").filter((w) => w.length > 2));
}

/**
 * Похожесть двух заголовков по Жаккару — доля общих слов.
 *
 * Точное совпадение строк тут не годится: вирусный хук расходится по
 * авторам с мелкими правками («I Quit My Job After This» против
 * «She Quit Her Job After This»), и такой повтор в ленте заметен.
 */
function titleSimilarity(a, b) {
  const tokensA = titleTokens(a);
  const tokensB = titleTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }

  return shared / (tokensA.size + tokensB.size - shared);
}

/**
 * Убирает кандидатов, чей заголовок слишком похож на уже опубликованный
 * или на другого кандидата из этой же выборки.
 *
 * @param {TrendCandidate[]} candidates
 * @param {string[]} publishedTitles заголовки за последние N дней
 * @param {number} threshold доля общих слов, начиная с которой считаем повтором
 */
function dedupe(candidates, publishedTitles = [], threshold = 0.6) {
  const kept = [];

  for (const candidate of candidates) {
    const clashesWithHistory = publishedTitles.some(
      (title) => titleSimilarity(candidate.title, title) >= threshold
    );
    if (clashesWithHistory) continue;

    const clashesWithKept = kept.some(
      (other) => titleSimilarity(candidate.title, other.title) >= threshold
    );
    if (clashesWithKept) continue;

    kept.push(candidate);
  }

  return kept;
}

/**
 * Ранжирует кандидатов по скорости набора просмотров, от самых вирусных.
 * Исходный массив не мутируется.
 */
function rank(candidates, now = new Date()) {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      viewsPerHour: computeViewsPerHour(candidate.views, candidate.publishedAt, now),
    }))
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
}

/**
 * Полный отбор: ранжирование, отсев повторов, обрезка до limit.
 *
 * Порядок важен — сначала ранжируем, потом дедуплицируем, чтобы из группы
 * похожих заголовков остался самый вирусный, а не случайный.
 */
function selectTop(candidates, { publishedTitles = [], limit = 10, threshold = 0.6, now } = {}) {
  const ranked = rank(candidates, now);
  return dedupe(ranked, publishedTitles, threshold).slice(0, limit);
}

module.exports = {
  computeViewsPerHour,
  normalizeTitle,
  titleSimilarity,
  dedupe,
  rank,
  selectTop,
  MIN_AGE_HOURS,
};
