#!/bin/bash
# Применяет bootstrap → все supabase/migrations/*.sql по порядку → grants.
# Выполняется один раз Docker-образом postgres при первом старте на пустом volume
# (стандартный механизм /docker-entrypoint-initdb.d).
set -e

echo "[pg-init] bootstrap"
: "${AUTHENTICATOR_PASSWORD:?AUTHENTICATOR_PASSWORD не задан}"
psql -v ON_ERROR_STOP=1 -v authenticator_password="$AUTHENTICATOR_PASSWORD" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /pg-init-extra/0000_bootstrap.sql

for f in /pg-init-migrations/*.sql; do
  echo "[pg-init] applying $f"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
done

echo "[pg-init] grants"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /pg-init-extra/9999_grants.sql

echo "[pg-init] done"
