#!/usr/bin/env node
/**
 * Показывает TELEGRAM_CHAT_ID — куда бот будет присылать рилсы.
 *
 * Ссылки на бота для доставки недостаточно: бот не пишет сам себе, ему нужен
 * идентификатор получателя, и узнать его можно только после того, как
 * получатель напишет боту первым (Bot API не даёт писать незнакомым).
 *
 *   1. откройте бота и отправьте ему любое сообщение (или /start);
 *   2. TELEGRAM_BOT_TOKEN=... node bin/tg-chat-id.js
 *
 * Для канала или группы: добавьте бота туда администратором и напишите
 * в чат любое сообщение — ниже появится их отрицательный chat_id.
 */

const { callApi } = require("../delivery/telegram");

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");

  const me = await callApi({ token, method: "getMe", body: {} });
  console.log(`Бот: @${me.username}\n`);

  const updates = await callApi({ token, method: "getUpdates", body: { limit: 100 } });

  // Один и тот же чат приходит в каждом апдейте — показываем каждый однажды.
  const chats = new Map();
  for (const update of updates) {
    const chat = (update.message || update.channel_post || {}).chat;
    if (chat) chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    console.log(
      "Сообщений нет. Напишите боту любое сообщение и запустите снова.\n" +
        "Если бот уже подключён к вебхуку, getUpdates всегда пуст — " +
        "снимите вебхук методом deleteWebhook."
    );
    return;
  }

  for (const chat of chats.values()) {
    const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    console.log(`TELEGRAM_CHAT_ID=${chat.id}   ${chat.type}: ${name || "без названия"}`);
  }
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
