// Отложенная публикация статей "Базы знаний" (public.blog_articles.scheduled_at, см. миграцию 0036).
// Та же схема, что и lifecycle.js: лёгкий периодический тикер поверх pool, минуя Supabase-shim/RLS
// (это серверный процесс, не запрос от имени конкретного пользователя). В отличие от писем здесь
// нечего "заявлять" заранее (claim) — одного UPDATE по условию достаточно, гонка невозможна: строка
// либо ещё is_published=false и попадёт под условие, либо уже true и следующий тик её не тронет.
import { pool } from "./db.js";

const TICK_MS = 60 * 1000;

export async function publishScheduledArticles() {
  // published_at = scheduled_at (не now()) — так дата публикации совпадает с тем временем, которое
  // выбрал админ, а не "когда тикер успел долистать" (до минуты расхождения из-за периода опроса).
  const { rows } = await pool.query(
    `update public.blog_articles
     set is_published = true, published_at = scheduled_at, scheduled_at = null
     where is_published = false and scheduled_at is not null and scheduled_at <= now()
     returning slug, title`
  );
  if (rows.length) console.log(`[blog] опубликовано по расписанию: ${rows.map((r) => r.slug).join(", ")}`);
  return rows.length;
}

export function startBlogScheduler() {
  const tick = () => publishScheduledArticles().catch((e) => console.warn("[blog] сбой планировщика публикации:", e?.message ?? e));
  setTimeout(tick, 15 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
}
