/**
 * Тематики, под которые отбираются вирусные хуки для англоязычной аудитории.
 *
 * Ключ — внутренний идентификатор ниши (попадает в кандидата и в лог),
 * queries — поисковые запросы к источнику трендов. Запросы намеренно
 * разговорные: вирусные Shorts называются человеческим языком, а не
 * категориями, поэтому «how i made money with ai» находит больше, чем «AI monetization».
 */

const NICHES = [
  {
    key: "money",
    title: "Деньги",
    queries: ["how i made money", "money mistakes", "get rich habits"],
  },
  {
    key: "ai_income",
    title: "Заработок на ИИ",
    queries: ["make money with ai", "ai side hustle", "ai tools to get paid"],
  },
  {
    key: "online_income",
    title: "Заработок в интернете",
    queries: ["online side hustle", "work from home income", "passive income online"],
  },
  {
    key: "health",
    title: "Здоровье",
    queries: ["health tips doctor", "symptoms you ignore", "gut health hack"],
  },
  {
    key: "relationships",
    title: "Отношения",
    queries: ["relationship red flags", "signs he loves you", "dating advice truth"],
  },
  {
    key: "weight_loss",
    title: "Похудение",
    queries: ["how i lost weight", "belly fat mistake", "weight loss without gym"],
  },
  {
    key: "healthy_lifestyle",
    title: "Здоровый образ жизни",
    queries: ["morning routine habits", "healthy habits that changed", "sleep better tip"],
  },
  {
    key: "parenting",
    title: "Дети и родители",
    queries: ["parenting hack", "what not to say to your kid", "raising kids mistake"],
  },
  {
    key: "motherhood",
    title: "Счастливое материнство",
    queries: ["mom life truth", "first year of motherhood", "things no one tells moms"],
  },
];

/** Ниши по ключам — для быстрой валидации входных фильтров. */
const NICHE_BY_KEY = new Map(NICHES.map((n) => [n.key, n]));

/**
 * Отбирает ниши по списку ключей. Пустой список означает «все ниши».
 * Неизвестный ключ — ошибка, а не молчаливый пропуск: опечатка в конфиге
 * иначе тихо сузила бы выборку и это заметили бы через неделю.
 */
function selectNiches(keys) {
  if (!keys || keys.length === 0) return NICHES;

  return keys.map((key) => {
    const niche = NICHE_BY_KEY.get(key);
    if (!niche) {
      throw new Error(
        `Unknown niche "${key}". Known: ${[...NICHE_BY_KEY.keys()].join(", ")}`
      );
    }
    return niche;
  });
}

module.exports = { NICHES, NICHE_BY_KEY, selectNiches };
