#!/bin/sh
# Стартует контейнер как root (нужно, чтобы chown'уть смонтированный storage_data volume — на
# момент сборки образа его ещё не существует, поэтому владельца нельзя было зафиксировать в
# Dockerfile), затем навсегда передаёт управление процессу сервера под непривилегированным node
# (см. Dockerfile) — сам сервер root-права уже не держит ни секунды сверх необходимого.
set -e
mkdir -p "${STORAGE_ROOT:-/data/storage}"
chown -R node:node "${STORAGE_ROOT:-/data/storage}"
exec gosu node "$@"
