# n8n — оркестрация MARIA SMM OS

## Состав

- `registry.json` — машиночитаемый реестр всех 32 workflow (группы CORE, CONTENT, APPROVAL, PUBLICATION, METRICS, ANALYTICS, REPORT, OPS) с приоритетами, triggers, шагами и тестами. Полное описание — в `docs/n8n_workflows.md`.
- `workflows/*.json` — готовые к импорту шаблоны:
  - `WF-CORE-001-error-handler.json` — глобальный обработчик ошибок (retry policy + dead-letter);
  - `WF-CORE-002-job-intake.json` — приём jobs по webhook с проверкой HMAC;
  - `WF-CORE-003-dispatcher.json` — поминутный диспетчер очереди (`claim_automation_jobs`, SKIP LOCKED);
  - `WF-CORE-004-emit-event.json` — отправка событий в исходящие вебхуки платформы (через `/api/internal/events`);
  - `WF-PUB-001-dispatcher.json` — маршрутизация публикации по платформе;
  - `WF-PUB-002-publish-vk.json` — VK (wall.post, текстовые посты);
  - `WF-PUB-003-publish-telegram.json` — Telegram (sendMessage);
  - `WF-PUB-004-publish-max.json` — MAX (Bot API /messages);
  - `WF-PUB-006-publish-vcru.json` — VC.ru (Osnova API entry/create);
  - `WF-PUB-007-publish-youtube.json` — YouTube (загрузка видео из медиатеки).

## Порядок установки

1. Разверните n8n (`docker compose up -d n8n` из корня репозитория).
2. Создайте Postgres-credential «Supabase Postgres (service)» — connection string вашего Supabase (Session mode, порт 5432).
3. Импортируйте workflows в порядке:
   CORE-001 → CORE-004 → CORE-002 → CORE-003 → PUB-002 → PUB-003 → PUB-004 → PUB-006 → PUB-007 → PUB-001.
4. В каждом импортированном workflow замените placeholder'ы:
   - `REPLACE_WITH_SUPABASE_PG_CREDENTIAL` → ваш Postgres-credential;
   - `REPLACE_WITH_WF_*_ID` → ID соответствующих импортированных workflow
     (в PUB-001 — все пять publisher'ов; в publisher'ах — WF-CORE-004; в CORE-003 — WF-PUB-001);
   - в PUB-007 — `REPLACE_WITH_YOUTUBE_OAUTH_CREDENTIAL` → OAuth2-credential YouTube (см. ниже).
5. Назначьте `WF-CORE-001` как error workflow для всех остальных (Settings → Error Workflow).
6. Активируйте (toggle Active) CORE-002 и CORE-003.
7. Переменные окружения уже прописаны в `docker-compose.yml`; `N8N_WEBHOOK_TOKEN` должен совпадать со значением в приложении (bootstrap задаёт его один раз в `.env`).

## Что нужно для каждой платформы

| Платформа | Токен в поле «Токен» при подключении канала | ID канала (`external_channel_id`) | Примечания |
|---|---|---|---|
| Telegram | Bot token от @BotFather | chat_id канала (например `-1001234567890`) | Бот — админ канала с правом публикации |
| VK | Ключ доступа сообщества (Настройки → Работа с API) со scope `wall` | ID сообщества (`123456` или `-123456`) | MVP публикует текст; фото/видео — следующий шаг |
| MAX | Bot token | chat_id канала/чата | Бот добавлен в канал |
| VC.ru | X-Device-Token аккаунта | subsite_id (ID блога/подсайта), можно пустым | Osnova API; версия задаётся `VCRU_API_BASE` |
| YouTube | — (токен канала не нужен) | ID YouTube-канала (для метрик) | Публикация через OAuth2-credential в n8n: Google Cloud Console → создать OAuth client (YouTube Data API v3, scope upload) → в n8n Credentials → YouTube OAuth2 API → Connect. К варианту контента должно быть прикреплено видео из медиатеки |

## Правила (из спецификации)

- Не сохранять токены в execution data; секреты разрешаются server-side через `public.resolve_integration_secret(secret_ref)`.
- Не публиковать повторно после timeout без reconciliation (WF-PUB-005).
- `NULL` ≠ 0: недоступные метрики остаются NULL.
- Одна платформа — один publisher workflow.
- Retry: 1m → 5m → 20m → 1h → manual review (реализовано экспоненциальной задержкой в WF-CORE-001).
