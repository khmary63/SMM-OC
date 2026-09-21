#!/usr/bin/env node
/**
 * Запуск одного слота: собрать рилс и прислать его в Telegram.
 *
 * Это точка входа для расписания — n8n дёргает её дважды в сутки
 * (см. docs/instagram_reels_daily.md §4). Один запуск = один рилс.
 *
 *   node bin/run.js
 *   node bin/run.js --niches money,ai_income
 *
 * Ключи берутся из окружения, ни один не должен попадать в репозиторий:
 *   YOUTUBE_API_KEY, GOOGLE_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN,
 *   TELEGRAM_CHAT_ID, VIDEO_RENDER_URL, VIDEO_RENDER_TOKEN
 */

const fs = require("fs");
const path = require("path");
const { runPipeline } = require("../pipeline");

/** История хуков и занятых подложек между запусками. */
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "..", ".state.json");

/** Сколько дней хук считается «недавно опубликованным» (ТЗ: 30). */
const HISTORY_DAYS = 30;

function parseArgs(argv) {
  const args = { niches: [], windowHours: 24 };

  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--niches":
        args.niches = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
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

/** Переменные окружения, без которых запускаться бессмысленно. */
function readEnv(env = process.env) {
  const required = [
    "YOUTUBE_API_KEY",
    "GOOGLE_ACCESS_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "VIDEO_RENDER_URL",
    "VIDEO_RENDER_TOKEN",
  ];

  const missing = required.filter((name) => !String(env[name] || "").trim());
  if (missing.length > 0) {
    throw new Error(`Не заданы переменные окружения: ${missing.join(", ")}`);
  }

  return {
    youtubeApiKey: env.YOUTUBE_API_KEY,
    googleAccessToken: env.GOOGLE_ACCESS_TOKEN,
    telegram: { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
    render: { url: env.VIDEO_RENDER_URL, token: env.VIDEO_RENDER_TOKEN },
  };
}

/** Битое или отсутствующее состояние — не повод падать: это лишь история. */
function loadState(file = STATE_FILE) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return { published: state.published || [], usageLog: state.usageLog || {} };
  } catch {
    return { published: [], usageLog: {} };
  }
}

function saveState(state, file = STATE_FILE) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Записи за последние HISTORY_DAYS дней. С их заголовками сверяется
 * дедупликация, и они же остаются в файле — старые просто уходят.
 */
function pruneHistory(published, now = new Date()) {
  const since = now.getTime() - HISTORY_DAYS * 24 * 3_600_000;
  return published.filter((item) => new Date(item.at).getTime() >= since);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnv();
  const state = loadState();
  const now = new Date();
  const history = pruneHistory(state.published, now);

  const result = await runPipeline({
    ...env,
    niches: args.niches,
    windowHours: args.windowHours,
    publishedTitles: history.map((item) => item.title),
    usageLog: state.usageLog,
    now,
    log: (message) => console.log(message),
  });

  saveState({
    published: [...history, { title: result.publishedTitle, at: now.toISOString() }],
    usageLog: result.usageLog,
  });

  console.log("\nГотово. Рилс отправлен в Telegram.");
  if (result.render.overflow) {
    console.log("Внимание: надпись не влезла в кадр, рендер её обрезал.");
  }
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
