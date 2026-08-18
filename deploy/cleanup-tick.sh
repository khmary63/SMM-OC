#!/bin/sh
# MARIA SMM OS — ежедневный тик WF-OPS-003 (Retention and Cleanup).
set -eu
ENV_FILE="/opt/maria-smm-os/.env"
TOKEN=$(grep '^N8N_WEBHOOK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
BODY='{}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$TOKEN" | sed 's/^.* //')
curl -s -m 60 -X POST http://127.0.0.1:5678/webhook/smm-os/wf/cleanup \
  -H 'content-type: application/json' -H "x-smm-signature: $SIGNATURE" -d "$BODY" \
  -o /dev/null -w '%{http_code}\n'

# Временные файлы рендера видео (video-worker пишет в /tmp/maria-render
# внутри контейнера, старше суток удаляем).
docker exec maria-smm-os-video-worker-1 sh -c \
  "find /tmp/maria-render -mindepth 1 -maxdepth 1 -type d -mtime +1 -exec rm -rf {} +" \
  2>/dev/null || true
