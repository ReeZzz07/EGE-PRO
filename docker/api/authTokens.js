// Одноразовые токены подтверждения email / сброса пароля — чистая логика над auth.action_tokens
// (см. миграцию 0025_auth_action_tokens.sql), без Express/почты, легко тестируется отдельно
// (см. test/authTokens.test.js). Письма шлёт docker/api/mailer.js, маршруты — server.js.
import crypto from "node:crypto";
import { pool } from "./db.js";

const TOKEN_BYTES = 32;
const VERIFY_TTL_MS = 24 * 3600 * 1000; // подтверждение email — сутки, не срочно
const RESET_TTL_MS = 60 * 60 * 1000; // сброс пароля — час, короче именно потому что чувствительнее

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Генерирует новый токен (возвращается как есть, для ссылки в письме — в БД попадает только
 * его sha256-хеш, см. миграцию). Заодно гасит все прежние неиспользованные токены ЭТОГО ЖЕ
 * пользователя и назначения — иначе после повторного запроса ("не пришло письмо, пришлю ещё раз")
 * оставались бы одновременно рабочими несколько ссылок из разных писем. */
export async function createActionToken(userId, purpose) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const ttl = purpose === "reset_password" ? RESET_TTL_MS : VERIFY_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await pool.query("update auth.action_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null", [userId, purpose]);
  await pool.query("insert into auth.action_tokens (user_id, purpose, token_hash, expires_at) values ($1, $2, $3, $4)", [userId, purpose, hashToken(token), expiresAt]);
  return token;
}

/** Проверяет токен и сразу же помечает его использованным — атомарно одним UPDATE ... RETURNING,
 * чтобы два конкурентных запроса с одним и тем же токеном (двойной клик по ссылке, повторная
 * отправка формы) не могли оба пройти проверку. Возвращает user_id при успехе, иначе null —
 * вызывающий код не должен различать "не найден"/"истёк"/"уже использован" в ответе пользователю
 * (одна и та же нейтральная ошибка "ссылка недействительна или устарела" для всех случаев). */
export async function consumeActionToken(token, purpose) {
  const { rows } = await pool.query(
    `update auth.action_tokens
     set used_at = now()
     where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
     returning user_id`,
    [hashToken(token), purpose]
  );
  return rows[0]?.user_id ?? null;
}
