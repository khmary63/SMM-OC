# Telegram MTProto Stats Collector

Микросервис расширенной статистики Telegram-каналов (Bot API её не предоставляет).

## Почему отдельный сервис

- MTProto-сессия — чувствительный секрет; она не покидает контейнер;
- bot token (публикация) и MTProto session (статистика) разделены по требованию архитектуры (§15);
- n8n обращается к сервису по HTTP с bearer-токеном.

## Подготовка сессии

1. Создайте приложение на https://my.telegram.org → API ID + API Hash.
2. Сгенерируйте StringSession локально:

```python
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

with TelegramClient(StringSession(), API_ID, API_HASH) as client:
    print(client.session.save())
```

3. Задайте переменные окружения: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`, `TELEGRAM_STATS_TOKEN`.

## API

| Method | Path | Описание |
|---|---|---|
| GET | `/health` | статус MTProto-сессии |
| POST | `/channel-stats` | `{"channel": "@name"}` → followers/reach/shares (null, если недоступно) |
| POST | `/post-stats` | `{"channel": "@name", "message_id": 1}` → views/forwards/reactions |

Аккаунт сессии должен быть админом канала с доступом к статистике, иначе расширенные метрики вернутся как `null` (это корректное поведение — не 0).
