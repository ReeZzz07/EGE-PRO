#!/usr/bin/env bash
# Деплой origin/main на прод. С хоста (LF):
#   Get-Content scripts/deploy-prod-main.sh -Raw | ssh ... bash -s
set -euo pipefail
cd /opt/ege-pro

echo "[deploy] before=$(git rev-parse --abbrev-ref HEAD) $(git log -1 --oneline)"
git fetch origin main
git checkout -B main origin/main
echo "[deploy] HEAD=$(git log -1 --oneline)"

echo "[deploy] rebuild api + force-recreate web/caddy (bind-mount inode + npm build)"
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps web caddy

echo "[deploy] wait for healthy"
for i in $(seq 1 36); do
  api=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ege-pro-api-1 2>/dev/null || echo missing)
  web=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ege-pro-web-1 2>/dev/null || echo missing)
  echo "  try $i api=$api web=$web"
  if [ "$api" = healthy ] && [ "$web" = healthy ]; then
    break
  fi
  sleep 5
done

echo "[deploy] compose ps"
docker compose -f docker-compose.prod.yml ps

echo "[deploy] local health via api container"
docker compose -f docker-compose.prod.yml exec -T api \
  node -e "require('http').get('http://127.0.0.1:8787/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(r.statusCode,d);process.exit(r.statusCode===200?0:1)})}).on('error',e=>{console.error(e);process.exit(1)})"

echo "[deploy] done"
