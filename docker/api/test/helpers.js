// Общие хелперы для тестов серверной логики (node --test, см. package.json → scripts.test).
// Гоняются на локальном Postgres из docker-compose (порт проброшен на хост как 5544) — тот же
// подход, что и в ручном QA этого проекта: одноразовые тестовые пользователи создаются и
// удаляются напрямую через SQL, без прохождения через HTTP/PostgREST.
//
// DATABASE_URL, если не задан явно, берёт дефолт для локального docker-compose (см. db.js) — так
// что `npm test` работает "из коробки" на машине, где стек поднят через `docker compose up`.
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const TEST_EMAIL_DOMAIN = "tariffgate-test.local";

/** Создаёт одноразового пользователя с профилем (профиль создаётся автоматически триггером
 * on_auth_user_created — см. supabase/migrations/0001_init.sql), опционально сразу выставляя
 * is_admin/tariff_id. Прямое SQL-подключение (не через PostgREST) — auth.uid() внутри триггеров
 * при этом null, что protect_admin_flag и enforce_subject_limit трактуют как доверенный контекст
 * (см. комментарии в самих миграциях), поэтому is_admin здесь можно выставлять свободно. */
export async function createTestUser({ isAdmin = false, tariffId = "free" } = {}) {
  const email = `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
  const { rows } = await pool.query(`insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, 'x', now()) returning id`, [email]);
  const id = rows[0].id;
  await pool.query(`update public.profiles set is_admin = $2, tariff_id = $3 where id = $1`, [id, isAdmin, tariffId]);
  return id;
}

/** delete от auth.users каскадом уносит profiles/profile_subjects/ai_messages — тот же паттерн
 * очистки, что использовался в ручном QA этой сессии. */
export async function deleteTestUser(id) {
  await pool.query(`delete from auth.users where id = $1`, [id]);
}

/** На случай, если тест упал посередине и не успел вызвать deleteTestUser — подчищает всё, что
 * осталось с прошлых прогонов, по домену тестовых email. Вызывается в before/after каждого файла. */
export async function sweepLeftoverTestUsers() {
  await pool.query(`delete from auth.users where email like $1`, [`%@${TEST_EMAIL_DOMAIN}`]);
}

export async function insertAiMessage(userId, { mode, role, createdAt }) {
  await pool.query(
    `insert into public.ai_messages (user_id, mode, role, content, created_at) values ($1, $2, $3, 'test', $4)`,
    [userId, mode, role, createdAt ?? new Date()]
  );
}

export { pool };
