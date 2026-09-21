#!/usr/bin/env node
/**
 * Живая проверка источника трендов: показывает, какие хуки он отдаёт прямо сейчас.
 *
 * Ничего не публикует и никуда не пишет — только читает YouTube Data API
 * и печатает отобранное. Нужен ключ в YOUTUBE_API_KEY.
 *
 *   YOUTUBE_API_KEY=... node bin/probe.js
 *   YOUTUBE_API_KEY=... node bin/probe.js --niches money,ai_income --limit 5
 */

const { fetchCandidates } = require("../sources/youtube");
const { selectTop } = require("../trends");
const { NICHE_BY_KEY } = require("../niches");

function parseArgs(argv) {
  const args = { niches: [], limit: 10, windowHours: 24 };

  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--niches":
        args.niches = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--limit":
        args.limit = Number(value);
        break;
      case "--window":
        args.windowHours = Number(value);
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { candidates, errors } = await fetchCandidates({
    niches: args.niches,
    windowHours: args.windowHours,
  });

  for (const { niche, error } of errors) {
    console.error(`[warn] ниша ${niche}: ${error}`);
  }

  const top = selectTop(candidates, { limit: args.limit });

  console.log(
    `\nСобрано ${candidates.length} кандидатов за ${args.windowHours} ч, ` +
      `после отбора осталось ${top.length}:\n`
  );

  top.forEach((c, i) => {
    const niche = NICHE_BY_KEY.get(c.niche)?.title || c.niche;
    console.log(`${String(i + 1).padStart(2)}. ${c.title}`);
    console.log(
      `    ${niche} · ${c.views.toLocaleString("ru-RU")} просмотров · ` +
        `${Math.round(c.viewsPerHour).toLocaleString("ru-RU")}/час · ${c.url}`
    );
  });

  if (top.length === 0) {
    console.log("Пусто. Проверьте ключ, квоту и порог minViews.");
  }
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
