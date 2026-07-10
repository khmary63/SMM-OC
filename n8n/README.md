# n8n — оркестрация MARIA SMM OS

## Состав

- `registry.json` — машиночитаемый реестр всех 32 workflow (группы CORE, CONTENT, APPROVAL, PUBLICATION, METRICS, ANALYTICS, REPORT, OPS) с приоритетами, triggers, шагами и тестами. Полное описание — в `docs/n8n_workflows.md`.
- `workflows/*.json` — готовые к импорту шаблоны ключевых workflow:
  - `WF-CORE-001-error-handler.json` — глобальный обработчик ошибок (retry policy + dead-letter);
  - `WF-CORE-002-job-intake.json` — приём jobs по webhook с проверкой HMAC;
  - `WF-CORE-003-dispatcher.json` — поминутный диспетчер очереди (`claim_automation_jobs`, SKIP LOCKED);
  - `WF-PUB-003-publish-telegram.json` — эталонный publisher (идемпотентность, server-side secret, snapshot jobs). VK/MAX publishers собираются по этому же образцу согласно `docs/n8n_workflows.md`.

## Порядок установки

1. Разверните n8n (`docker compose up n8n` из корня репозитория).
2. Создайте Postgres-credential «Supabase Postgres (service)» — connection string вашего Supabase (Session mode, порт 5432).
3. Импортируйте workflows в порядке: CORE-001 → CORE-002 → CORE-003 → PUB-003.
4. В каждом импортированном workflow замените `REPLACE_WITH_SUPABASE_PG_CREDENTIAL` на ваш credential, а в CORE-003 — ID sub-workflow.
5. Назначьте `WF-CORE-001` как error workflow для всех остальных (Settings → Error Workflow).
6. Задайте переменные окружения n8n (см. `docker-compose.yml`): `N8N_WEBHOOK_TOKEN` должен совпадать со значением в приложении.

## Правила (из спецификации)

- Не сохранять токены в execution data; секреты разрешаются server-side через `public.resolve_integration_secret(secret_ref)`.
- Не публиковать повторно после timeout без reconciliation (WF-PUB-005).
- `NULL` ≠ 0: недоступные метрики остаются NULL.
- Одна платформа — один publisher workflow.
- Retry: 1m → 5m → 20m → 1h → manual review (реализовано экспоненциальной задержкой в WF-CORE-001).
