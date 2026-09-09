#!/usr/bin/env bash
# Восстановление из бэкапа, сделанного scripts/backup.sh. Останавливает api/web (чтобы никто не
# писал в базу/сторадж во время восстановления), накатывает дамп поверх ЧИСТОЙ базы и разворачивает
# архив storage_data, затем поднимает стек обратно.
#
# Использование:
#   scripts/restore.sh <path/to/pg_TIMESTAMP.dump> <path/to/storage_TIMESTAMP.tar.gz>
#
# ВНИМАНИЕ: перезаписывает текущие данные стека необратимо. Это не тот скрипт, который стоит
# запускать не глядя — если под рукой есть текущие данные, которые жаль потерять, сначала прогони
# scripts/backup.sh и убедись, что новый бэкап лежит в безопасном месте.
set -euo pipefail
# см. тот же комментарий в scripts/backup.sh — без этого Git Bash на Windows ломает пути в `-v` у docker run
export MSYS_NO_PATHCONV=1

PG_DUMP="${1:?использование: scripts/restore.sh <pg_dump файл> <storage tar.gz файл>}"
STORAGE_TAR="${2:?использование: scripts/restore.sh <pg_dump файл> <storage tar.gz файл>}"
PROJECT="${COMPOSE_PROJECT_NAME:-ege-pro}"

[ -f "$PG_DUMP" ] || { echo "не найден файл дампа: $PG_DUMP" >&2; exit 1; }
[ -f "$STORAGE_TAR" ] || { echo "не найден архив storage: $STORAGE_TAR" >&2; exit 1; }

read -r -p "Это ПЕРЕЗАПИШЕТ текущие данные стека (база + файлы). Продолжить? [y/N] " CONFIRM
[ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ] || { echo "отменено"; exit 1; }

echo "[restore] останавливаю api/web..."
docker compose stop api web

echo "[restore] пересоздаю базу postgres из дампа..."
docker compose exec -T postgres psql -U postgres -d postgres -c "drop schema if exists public cascade; drop schema if exists auth cascade;"
docker compose exec -T postgres pg_restore -U postgres -d postgres --no-owner < "$PG_DUMP"

echo "[restore] разворачиваю storage_data из архива (текущее содержимое тома стирается)..."
docker run --rm \
  -v "${PROJECT}_storage_data:/data" \
  -v "$(cd "$(dirname "$STORAGE_TAR")" && pwd)/$(basename "$STORAGE_TAR"):/backup.tar.gz:ro" \
  alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup.tar.gz -C /data"

echo "[restore] схема кэша PostgREST могла устареть — перезапускаю postgrest..."
docker compose restart postgrest

echo "[restore] поднимаю api/web обратно..."
docker compose up -d api web

echo "[restore] готово."
