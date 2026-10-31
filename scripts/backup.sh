#!/usr/bin/env bash
# Бэкап двух постоянных docker-томов локального стека (docker-compose.yml): pgdata (вся база —
# аккаунты, попытки, банк заданий, тарифы...) и storage_data (аватарки, картинки заданий, залитые
# через ручной импорт). До этого скрипта у стека вообще не было механизма бэкапа — единственной
# копией данных был сам работающий volume на диске, без снапшотов и без восстановления после
# случайного `docker volume rm`/порчи диска.
#
# Использование:
#   scripts/backup.sh [каталог-назначения]     # по умолчанию — ./backups
#
# Off-site копия (опционально): задай BACKUP_REMOTE_DIR=/mnt/backup-disk/ege-pro или путь к
# смонтированному бакету — после локального дампа скрипт скопирует туда свежие файлы.
#
# Восстановление — см. scripts/restore.sh.
set -euo pipefail
# На Windows + Git Bash сама Git Bash переписывает похожие на пути аргументы (в т.ч. внутри
# `-v host:container` у docker run) под MSYS-конвенции и этим ломает volume-маппинг — без этого
# tar внутри контейнера получал несуществующий /backup (не туда, куда реально смонтирован каталог).
export MSYS_NO_PATHCONV=1

DEST="${1:-$(dirname "$0")/../backups}"
PROJECT="${COMPOSE_PROJECT_NAME:-ege-pro}"
STAMP="$(date +%Y%m%d_%H%M%S)"
# Compose-файл: в проде обычно COMPOSE_FILE=docker-compose.prod.yml
COMPOSE_ARGS=()
if [[ -n "${COMPOSE_FILE:-}" ]]; then
  COMPOSE_ARGS=(-f "$COMPOSE_FILE")
fi

mkdir -p "$DEST"

echo "[backup] дамп Postgres (pg_dump, custom-формат) → $DEST/pg_${STAMP}.dump"
docker compose "${COMPOSE_ARGS[@]}" exec -T postgres pg_dump -U postgres -d postgres -Fc > "$DEST/pg_${STAMP}.dump"

echo "[backup] архив тома storage_data → $DEST/storage_${STAMP}.tar.gz"
docker run --rm \
  -v "${PROJECT}_storage_data:/data:ro" \
  -v "$(cd "$DEST" && pwd):/backup" \
  alpine sh -c "tar czf /backup/storage_${STAMP}.tar.gz -C /data ."

echo "[backup] готово: pg_${STAMP}.dump, storage_${STAMP}.tar.gz"

if [[ -n "${BACKUP_REMOTE_DIR:-}" ]]; then
  mkdir -p "$BACKUP_REMOTE_DIR"
  echo "[backup] копирую off-site → $BACKUP_REMOTE_DIR"
  cp -f "$DEST/pg_${STAMP}.dump" "$DEST/storage_${STAMP}.tar.gz" "$BACKUP_REMOTE_DIR/"
  echo "[backup] off-site копия готова"
else
  echo "[backup] это ЛОКАЛЬНЫЕ файлы на этой машине — для реальной защиты от потери диска задай"
  echo "         BACKUP_REMOTE_DIR=/путь/к/другому/хранилищу или скопируй $DEST вручную."
fi
