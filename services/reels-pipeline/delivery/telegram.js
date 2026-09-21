/**
 * Доставка готового рилса в Telegram.
 *
 * Последний шаг пайплайна: Мария получает в бота видео и готовые тексты,
 * открывает Instagram, накладывает трек из библиотеки и публикует. Это
 * вариант «полуавтомат» из docs/instagram_reels_daily.md §3.3 — музыку
 * Instagram через API не прикрепить, а без неё охваты заметно ниже.
 *
 * Заодно снимается блокер §3.5: Telegram принимает файл прямой загрузкой,
 * поэтому публичный URL для отрендеренного MP4 не нужен.
 *
 * С российского сервера api.telegram.org заблокирован — в docker-compose.yml
 * он проксируется прозрачно (tg-proxy-forward + extra_hosts), поэтому здесь
 * обычный адрес и ничего настраивать не нужно.
 */

const API_BASE = "https://api.telegram.org";

/** Подпись к видео — 1024 символа, пост Марии заведомо длиннее. */
const CAPTION_LIMIT = 1024;

/** Обычное текстовое сообщение — 4096 символов. */
const MESSAGE_LIMIT = 4096;

/** Бот не умеет загружать файлы тяжелее 50 МБ. */
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;

/**
 * Вызов Bot API.
 *
 * Токен в текст ошибки не попадает намеренно: он стоит в пути запроса, и
 * наивное `Ошибка при запросе ${url}` разложило бы его по логам и трекерам.
 */
async function callApi({ token, method, body, fetchImpl = fetch }) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "content-type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.description || `HTTP ${res.status}`}`
    );
  }

  return data.result;
}

/**
 * Режет текст на куски под лимит сообщения.
 *
 * Обрезать нельзя: пост приходит к Марии для публикации целиком, и молча
 * потерянный хвост она заметит уже в Instagram. Режем по абзацам, чтобы
 * стык не приходился на середину предложения.
 */
function splitMessage(text, limit = MESSAGE_LIMIT) {
  const source = String(text).trim();
  if (source.length <= limit) return [source];

  const chunks = [];
  let current = "";

  for (const paragraph of source.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    // Абзац длиннее лимита сам по себе — режем по живому, иначе не отправить.
    let rest = paragraph;
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function sendMessage({ token, chatId, text, fetchImpl = fetch }) {
  const results = [];
  for (const chunk of splitMessage(text)) {
    results.push(
      await callApi({
        token,
        method: "sendMessage",
        // parse_mode не включаем: тексты приходят от модели и содержат
        // и кавычки, и звёздочки, и угловые скобки. Любая разметка тут
        // означала бы экранирование чужого текста, а ошибка экранирования —
        // отвалившееся сообщение вместо готового поста.
        body: { chat_id: String(chatId), text: chunk, disable_web_page_preview: true },
        fetchImpl,
      })
    );
  }
  return results;
}

async function sendVideo({
  token,
  chatId,
  video,
  filename = "reel.mp4",
  caption,
  fetchImpl = fetch,
}) {
  if (video.length > VIDEO_SIZE_LIMIT) {
    throw new Error(
      `Видео ${Math.round(video.length / 1024 / 1024)} МБ — Bot API не берёт ` +
        `тяжелее ${VIDEO_SIZE_LIMIT / 1024 / 1024} МБ`
    );
  }

  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("video", new Blob([video], { type: "video/mp4" }), filename);
  form.set("supports_streaming", "true");
  if (caption) form.set("caption", caption.slice(0, CAPTION_LIMIT));

  return callApi({ token, method: "sendVideo", body: form, fetchImpl });
}

/**
 * Сводка к видео: по ней Мария решает, публиковать как есть или переделать.
 *
 * Предупреждения идут первыми и только если есть что сказать: «всё хорошо»
 * в каждом сообщении быстро перестаёт читаться, а вот строка про переполнение
 * надписи должна попадаться на глаза до публикации, а не после.
 */
function buildBrief({ reel, render = {} }) {
  const warnings = [];

  if (render.overflow) {
    warnings.push("надпись не влезла в кадр — текст обрезан рендером");
  }
  if (!reel.checks?.overlayEn?.ok) {
    warnings.push(
      `надпись: ${reel.checks?.overlayEn?.problems?.join("; ") || "не прошла проверку"}`
    );
  }
  if (!reel.checks?.post?.ok) {
    warnings.push(
      `пост: ${reel.checks?.post?.problems?.join("; ") || "не прошёл проверку"}`
    );
  }

  return [
    ...(warnings.length ? [`⚠️ ${warnings.join("\n⚠️ ")}`, ""] : []),
    `Надпись на видео: ${reel.en.overlay}`,
    `Тренд-источник: ${reel.trend.title}`,
    reel.trend.url,
  ].join("\n");
}

/**
 * Отправляет рилс одним заходом: видео со сводкой, затем тексты.
 *
 * Тексты отдельными сообщениями, потому что подпись к видео ограничена
 * 1024 символами, а пост по инструкции — 1700–1900. Каждый текст своим
 * сообщением, чтобы Мария копировала его целиком одним нажатием.
 */
async function deliverReel({ reel, video, token, chatId, render, fetchImpl = fetch }) {
  const sent = await sendVideo({
    token,
    chatId,
    video,
    caption: buildBrief({ reel, render }),
    fetchImpl,
  });

  await sendMessage({
    token,
    chatId,
    text: `Подпись для Instagram (EN):\n\n${reel.en.caption}`,
    fetchImpl,
  });

  await sendMessage({
    token,
    chatId,
    text: `Исходный пост (RU):\n\n${reel.ru.post}`,
    fetchImpl,
  });

  return sent;
}

module.exports = {
  deliverReel,
  sendVideo,
  sendMessage,
  splitMessage,
  buildBrief,
  callApi,
  API_BASE,
  CAPTION_LIMIT,
  MESSAGE_LIMIT,
  VIDEO_SIZE_LIMIT,
};
