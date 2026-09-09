// Общий пул подключений к Postgres — вынесен из server.js в отдельный модуль, чтобы модули с
// чистой бизнес-логикой (tariffGate.js) и их тесты (test/) могли использовать тот же pool, не
// импортируя server.js целиком (тот при импорте поднимает Express и слушает порт).
import pg from "pg";

// В контейнере DATABASE_URL всегда задан явно (см. docker-compose.yml). Фолбэк ниже нужен только
// тестам, которые гоняются с хоста через `npm test` (не в контейнере) — там DATABASE_URL обычно
// не экспортирован, а порт того же Postgres из docker-compose проброшен на хост как 5544.
const DEFAULT_HOST_TEST_URL = "postgres://postgres:postgres_local_pw@localhost:5544/postgres";

// Без явных лимитов pg.Pool по умолчанию допускает до 10 соединений и не обрывает зависший запрос —
// всплеск параллельных запросов (или один зависший на медленном запросе клиент) мог исчерпать пул
// на весь процесс. connectionTimeoutMillis — сколько ждём свободное соединение из пула, не сам сервер.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_HOST_TEST_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
