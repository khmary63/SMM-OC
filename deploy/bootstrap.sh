#!/usr/bin/env bash
# ============================================================================
# MARIA SMM OS — установка на чистый Ubuntu/Debian сервер одной командой.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/khmary63/SMM-OC/claude/platform-creation-vrft60/deploy/bootstrap.sh)
#
# Скрипт: ставит Docker + git, клонирует репозиторий в /opt/maria-smm-os,
# спрашивает ключи (Supabase, Anthropic), генерирует внутренние токены
# и поднимает всё через docker compose (web :80, n8n :5678).
# Повторный запуск безопасен: обновляет код и перезапускает контейнеры.
# ============================================================================

set -euo pipefail

REPO_URL="https://github.com/khmary63/SMM-OC.git"
BRANCH="claude/platform-creation-vrft60"
APP_DIR="/opt/maria-smm-os"

say()  { echo -e "\033[1;36m==>\033[0m $*"; }
fail() { echo -e "\033[1;31mОшибка:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root (ssh root@сервер)."

# ---------------------------------------------------------------------------
say "1/5 Устанавливаю зависимости (git, curl, docker)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

# Зеркала Docker Hub: registry-1.docker.io часто отвечает 429/блокируется из РФ
if [ ! -f /etc/docker/daemon.json ] || ! grep -q registry-mirrors /etc/docker/daemon.json; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://dockerhub.timeweb.cloud", "https://mirror.gcr.io"]
}
JSON
  systemctl restart docker >/dev/null 2>&1 || true
fi

systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || fail "docker compose plugin не установился."

# ---------------------------------------------------------------------------
say "2/5 Получаю код ($BRANCH)…"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ---------------------------------------------------------------------------
say "3/5 Настраиваю переменные окружения…"
ENV_FILE="$APP_DIR/.env"

ask() { # ask VAR "подсказка" [secret]
  local var="$1" prompt="$2" secret="${3:-}" current value
  current="$(grep -E "^${var}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
  if [ -n "$current" ] && [ "$current" != "CHANGE_ME" ]; then
    return 0 # уже задано
  fi
  if [ "$secret" = "secret" ]; then
    read -r -s -p "$prompt: " value </dev/tty; echo
  else
    read -r -p "$prompt: " value </dev/tty
  fi
  [ -n "$value" ] || fail "$var не может быть пустым."
  sed -i "/^${var}=/d" "$ENV_FILE" 2>/dev/null || true
  echo "${var}=${value}" >> "$ENV_FILE"
}

touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

SERVER_IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
grep -q "^APP_BASE_URL=" "$ENV_FILE" || echo "APP_BASE_URL=http://${SERVER_IP}" >> "$ENV_FILE"
grep -q "^N8N_PUBLIC_BASE_URL=" "$ENV_FILE" || echo "N8N_PUBLIC_BASE_URL=http://${SERVER_IP}:5678" >> "$ENV_FILE"
grep -q "^AI_MODEL=" "$ENV_FILE" || echo "AI_MODEL=claude-sonnet-5" >> "$ENV_FILE"

# внутренние токены генерируются автоматически
for var in N8N_WEBHOOK_TOKEN TELEGRAM_STATS_TOKEN VIDEO_RENDER_TOKEN; do
  grep -q "^${var}=" "$ENV_FILE" || echo "${var}=$(openssl rand -hex 24)" >> "$ENV_FILE"
done

echo
echo "  Понадобятся ключи Supabase (Project Settings → API) и Anthropic."
echo "  Ввод скрытых значений не отображается — это нормально."
echo
ask NEXT_PUBLIC_SUPABASE_URL      "Supabase URL (https://xxxx.supabase.co)"
ask NEXT_PUBLIC_SUPABASE_ANON_KEY "Supabase anon key" secret
ask SUPABASE_SERVICE_ROLE_KEY     "Supabase service role key" secret
ask ANTHROPIC_API_KEY             "Anthropic API key (sk-ant-…)" secret

# ---------------------------------------------------------------------------
say "4/5 Собираю и запускаю контейнеры (первая сборка ~5 минут)…"
docker compose --env-file "$ENV_FILE" up -d --build

# ---------------------------------------------------------------------------
say "5/5 Проверяю статус…"
sleep 5
docker compose ps

cat <<EOF

============================================================
  MARIA SMM OS развёрнута.

  Приложение:  http://${SERVER_IP}
  n8n:         http://${SERVER_IP}:5678
                (при первом входе создайте owner-аккаунт n8n,
                 затем импортируйте workflow из n8n/workflows/)

  Не забудьте:
  1. Применить миграции в Supabase (supabase/migrations/*.sql
     по порядку через SQL Editor), если ещё не применяли.
  2. В Supabase → Authentication → URL Configuration добавить
     http://${SERVER_IP} в Site URL / Redirect URLs.

  Логи:        cd $APP_DIR && docker compose logs -f web
  Обновление:  повторный запуск этого же скрипта.
============================================================
EOF
