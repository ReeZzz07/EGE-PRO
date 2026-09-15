#!/bin/sh
# Однократная настройка firewall на прод-сервере (Ubuntu/Debian, ufw) — см. SETUP.md → "Прод-деплой".
# Разрешает только SSH (22), HTTP (80, нужен Caddy для ACME-http-01 challenge и редиректа на https)
# и HTTPS (443). Всё остальное (5544/postgres, 8787/api, 3000/PostgREST дев-порты) в прод-конфиге
# (docker-compose.prod.yml) вообще не публикуется на хост, так что открывать их здесь не нужно —
# но default deny incoming закрывает и их на случай, если кто-то по ошибке добавит "ports:" обратно.
set -eu

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw не найден — установи: apt-get install -y ufw" >&2
  exit 1
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
