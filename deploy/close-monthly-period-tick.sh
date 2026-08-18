#!/bin/sh
# MARIA SMM OS — ежемесячный тик WF-AN-002 (Close Monthly Analytics Period).
set -eu

ENV_FILE="/opt/maria-smm-os/.env"
TOKEN=$(grep '^N8N_WEBHOOK_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
BODY='{}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$TOKEN" | sed 's/^.* //')

curl -s -m 60 -X POST http://127.0.0.1:5678/webhook/smm-os/wf/close-monthly-period \
  -H 'content-type: application/json' \
  -H "x-smm-signature: $SIGNATURE" \
  -d "$BODY" \
  -o /dev/null -w '%{http_code}\n'
