#!/usr/bin/env bash
# Деплой feat/pre-launch-roadmap на прод. С хоста (LF):
#   Get-Content scripts/deploy-prod-roadmap.sh -Raw | ... ssh ... bash -s
set -euo pipefail
cd /opt/ege-pro

echo "[deploy] fetch feat/pre-launch-roadmap (origin.fetch на проде — только main)"
git fetch origin feat/pre-launch-roadmap:refs/remotes/origin/feat/pre-launch-roadmap
git checkout -B feat/pre-launch-roadmap origin/feat/pre-launch-roadmap
echo "[deploy] HEAD=$(git log -1 --oneline)"

echo "[deploy] apply migration 0048 (idempotent)"
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d postgres < supabase/migrations/0048_launch_hardening.sql

echo "[deploy] rebuild + up (web builds inside container — may take a few minutes)"
docker compose -f docker-compose.prod.yml up -d --build

echo "[deploy] restart postgrest (schema cache)"
docker compose -f docker-compose.prod.yml restart postgrest

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

echo "[deploy] schema check"
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d postgres -c "select to_regclass('public.teacher_classes') as teacher_classes, to_regclass('public.client_errors') as client_errors; select column_name from information_schema.columns where table_name='profiles' and column_name='is_teacher';"

echo "[deploy] local health via api container"
docker compose -f docker-compose.prod.yml exec -T api \
  node -e "require('http').get('http://127.0.0.1:8787/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(r.statusCode,d);process.exit(r.statusCode===200?0:1)})}).on('error',e=>{console.error(e);process.exit(1)})"

echo "[deploy] done"
