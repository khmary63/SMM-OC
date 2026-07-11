# MARIA SMM OS — Публичный API и вебхуки

Интеграция платформы с любым внешним сервисом (CRM, Zapier/Make, собственные
скрипты) — по модели, аналогичной SMM-сервисам вроде postmypost.io:
API-ключи для входящих запросов + подписанные вебхуки для исходящих событий.

## Аутентификация

1. В приложении: **Настройки → API-ключи → Создать API-ключ**.
   Ключ вида `maria_…` показывается один раз.
2. Передавайте его в каждом запросе:

```
Authorization: Bearer maria_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Ключ привязан к workspace — все операции выполняются в его пределах.
База URL: `http://ВАШ_СЕРВЕР` (или ваш домен).

## Endpoints

### GET /api/v1/me
Информация о workspace и счётчики.

```bash
curl -H "Authorization: Bearer $KEY" http://SERVER/api/v1/me
```

### GET /api/v1/channels
Список каналов (VK, Telegram, MAX, YouTube, RuTube, Instagram…).

### GET /api/v1/content
Параметры: `brand_id`, `status`, `limit` (≤200).

### POST /api/v1/content
Создать единицу контента (и, опционально, первый вариант с текстом).

```bash
curl -X POST http://SERVER/api/v1/content \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "brand_id": "UUID_БРЕНДА",
    "title": "Пост про новинку",
    "body": "Текст поста…",
    "planned_at": "2026-07-15T10:00:00Z"
  }'
```

Ответ: `{"content_item": {...}, "content_variant_id": "..."}`.
Событие `content.created` уходит в вебхуки.

> Создание через API не минует согласование: чтобы опубликовать вариант,
> его должен утвердить согласующий (в интерфейсе или вашим процессом).

### GET /api/v1/publications
Параметры: `status`, `channel_id`, `limit`.

### POST /api/v1/publications
Поставить публикацию в очередь. Вариант должен быть `approved`, канал —
активен. Повторный запрос с теми же параметрами не создаёт дубль
(idempotency key).

```bash
curl -X POST http://SERVER/api/v1/publications \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content_variant_id": "UUID_ВАРИАНТА",
    "channel_id": "UUID_КАНАЛА",
    "scheduled_at": "2026-07-15T10:00:00Z"
  }'
```

### GET / POST / DELETE /api/v1/webhooks
Управление вебхуками через API (то же, что в настройках интерфейса).
`POST` принимает `{url, events[], description}` и возвращает `secret` один раз.
`DELETE /api/v1/webhooks?id=…` удаляет endpoint.

## Вебхуки (исходящие события)

Настраиваются в **Настройки → Вебхуки** или через API. На ваш URL приходит
POST с JSON:

```json
{
  "event": "publication.queued",
  "workspace_id": "…",
  "timestamp": "2026-07-11T12:00:00.000Z",
  "data": { "publication_id": "…", "channel_id": "…", "scheduled_at": "…" }
}
```

### События

| Событие | Когда |
|---|---|
| `content.created` | создана единица контента (через API) |
| `content.approved` | вариант согласован |
| `content.revision_requested` | отправлен на доработку |
| `publication.queued` | публикация поставлена в очередь |
| `publication.published` | опубликовано (передаёт n8n-контур) |
| `publication.failed` | ошибка публикации (передаёт n8n-контур) |
| `publication.cancelled` | публикация отменена |
| `metrics.collected` | собраны снимки метрик (n8n) |
| `report.generated` | готов месячный отчёт (n8n) |
| `recommendation.generated` | появилась рекомендация (n8n) |

Пустой список событий при создании endpoint'а = подписка на все.

### Проверка подписи

Каждый запрос содержит заголовки:

- `X-Maria-Event` — тип события;
- `X-Maria-Delivery` — ID доставки (для дедупликации повторов);
- `X-Maria-Signature` — hex(HMAC-SHA256(raw_body, secret)).

Проверка на Node.js:

```js
const crypto = require("crypto");

function verify(rawBody, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

Важно: считайте HMAC от **сырого тела запроса** (до JSON-парсинга).
Отвечайте любым 2xx в течение 8 секунд; неуспешные доставки помечаются
failed и переотправляются retry-контуром.

### События из n8n

События этапов, которые выполняет n8n (публикация вышла, метрики собраны),
публикуются в вебхуки через внутренний endpoint приложения:

```
POST http://web:3000/api/internal/events
x-smm-signature: hex(HMAC-SHA256(body, N8N_WEBHOOK_TOKEN))

{"workspace_id": "…", "event_type": "publication.published", "data": {…}}
```

Добавьте этот HTTP-вызов финальным шагом в publisher-workflow (после
«Save External ID») и в метрик-коллекторы.

## Ограничения текущей версии

- Rate limiting не встроен — при публичном размещении ограничьте частоту
  на уровне reverse-proxy.
- Ключ даёт полный доступ к workspace (скоупов пока нет).
- Вебхук-повторы: первая попытка синхронная, retry — через очередь
  `automation_jobs` (обрабатывает n8n-контур, WF-OPS).
