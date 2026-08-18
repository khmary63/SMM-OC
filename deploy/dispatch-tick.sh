#!/bin/sh
# MARIA SMM OS — внешний тик диспетчера очереди (WF-CORE-003).
# n8n's Schedule Trigger оказался ненадёжен в текущей версии (execution'ы
# зависают навсегда без видимой причины) — используем системный cron вместо
# него. Сама логика диспетчера (Claim Jobs, роутинг по job_type) не менялась,
# просто триггер стал Webhook вместо Schedule.
set -eu

ENV_FILE="/opt/maria-smm-os/.env"
TOKEN=$(grep '^N8N_WEBHOOK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
BODY='{}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$TOKEN" | sed 's/^.* //')

# lastNode response mode: ответ приходит только после завершения всей цепочки
# (Claim Jobs -> роутинг -> обработка -> Mark Succeeded), включая возможный
# рендер видео (до ~5 минут) — таймаут с запасом.
curl -s -m 330 -X POST http://127.0.0.1:5678/webhook/smm-os/dispatch \
  -H 'content-type: application/json' \
  -H "x-smm-signature: $SIGNATURE" \
  -d "$BODY" \
  -o /dev/null -w '%{http_code}\n'
