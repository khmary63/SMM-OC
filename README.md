# MARIA SMM OS

Операционная система SMM-агентства: замкнутый контур от стратегии до плана следующего месяца.

```text
Стратегия → Контент-план → Производство → Согласование → Очередь публикаций
  → Публикация (VK / Telegram / MAX) → Сбор метрик → Нормализация → Аналитика
  → Рекомендации → Контент-план следующего месяца
```

Полная спецификация — в [`docs/architecture.md`](docs/architecture.md), каталог из 32 n8n-workflow — в [`docs/n8n_workflows.md`](docs/n8n_workflows.md).

## Структура репозитория

```text
apps/web/                  Next.js 15 приложение (PWA, App Router, Tailwind)
supabase/migrations/       Схема PostgreSQL: таблицы, RLS, views, vault, jobs
n8n/                       Реестр workflow + импортируемые JSON-шаблоны
services/telegram-collector/  MTProto-статистика Telegram (FastAPI + Telethon)
services/video-worker/     FFmpeg-рендер коротких видео
docs/                      Архитектура и спецификации
docker-compose.yml         n8n + микросервисы
```

## Развёртывание на сервере одной командой

На чистом Ubuntu/Debian VPS (например, Timeweb) под root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/khmary63/SMM-OC/claude/platform-creation-vrft60/deploy/bootstrap.sh)
```

Скрипт установит Docker, склонирует репозиторий в `/opt/maria-smm-os`, спросит
ключи Supabase и Anthropic и поднимет всё: веб-приложение на порту 80, n8n на 5678,
Telegram-collector и video-worker. Повторный запуск обновляет систему.

Перед первым входом примените миграции из `supabase/migrations/` в вашем
Supabase-проекте и добавьте адрес сервера в Auth → URL Configuration.

## Быстрый старт (локальная разработка)

### 1. Supabase

1. Создайте проект на [supabase.com](https://supabase.com).
2. Примените миграции (по порядку) через SQL Editor или CLI:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Миграции создают: workspaces/роли, бренды, каналы, контент и версии, медиатеку,
согласования, публикации с idempotency, snapshots метрик, insights/recommendations,
отчёты, очередь `automation_jobs` c функцией `claim_automation_jobs`, RLS на всех
таблицах, аналитические views и защищённое хранилище секретов (`app_private`).

### 2. Веб-приложение

```bash
npm install
cp .env.example apps/web/.env.local   # заполните значения
npm run dev                            # http://localhost:3000
```

Обязательные переменные: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (только сервер), `ANTHROPIC_API_KEY` (AI-генерация).

### 3. Автоматизация (n8n + сервисы)

```bash
docker compose up -d
```

Затем импортируйте workflow из `n8n/workflows/` — порядок и настройка описаны в
[`n8n/README.md`](n8n/README.md).

## Что уже работает в приложении

- регистрация/вход (Supabase Auth), несколько изолированных workspace (RLS);
- роли: owner / admin / smm / editor / approver / viewer с матрицей прав;
- бренды с профилем (позиционирование, tone of voice, запрещённые темы и фразы, правила AI);
- подключение каналов VK / Telegram / MAX — токены уходят в `app_private`-хранилище, в браузер не возвращаются;
- контент-календарь, единицы контента, версии-адаптации под каналы;
- AI-генерация адаптаций (Claude API) с контролем запрещённых фраз — никогда не переводит материал в approved;
- медиатека (приватный bucket, signed URLs);
- согласование конкретной версии, запрет approve устаревшей версии;
- очередь публикаций: idempotency key sha256(workspace+channel+variant+time+version), отмена, ручной retry;
- дашборд и аналитика на SQL-витринах (`v_channel_daily_growth`, `v_content_performance`) — отсутствующая метрика показывается как «—», не 0;
- рекомендации с action/reason/evidence/confidence и принятием в работу;
- месячные отчёты (постановка в очередь) и AI-черновик плана следующего месяца (60/25/15), остающийся черновиком до ручного утверждения;
- REST API из спецификации §13 (13 endpoints) + очередь `automation_jobs` с HMAC-уведомлением n8n.

## Что выполняется контуром n8n (после импорта workflow)

Публикация в площадки, reconciliation после timeout, сбор канальных и постовых
snapshots (1h/6h/24h/72h/7d/30d), пересчёт аналитики, закрытие месячного периода,
генерация отчётов — по каталогу `docs/n8n_workflows.md`. Шаблоны CORE-группы и
эталонный Telegram-publisher уже готовы к импорту.

## Безопасность (инварианты спецификации §16)

1. Все проектные таблицы содержат `workspace_id` и закрыты RLS.
2. Секреты — только в `app_private.integration_secrets` (service role), в публичных таблицах лишь `secret_ref`.
3. Каждая публикация имеет idempotency key; после timeout — reconciliation, не слепой retry.
4. Каждый ответ API площадки сохраняется как `raw_payload`.
5. Недоступная метрика — `NULL`, не `0`.
6. Генерация не запускает публикацию автоматически.
7. Аналитика считается SQL-слоем; LLM только интерпретирует готовые агрегаты.
