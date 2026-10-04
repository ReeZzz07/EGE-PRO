// Отзывы о сервисе. Оставить отзыв может только тот, кто прошёл онбординг и диагностику и минимум
// REQUIRED_AI_REQUESTS раз обращался к ИИ-репетитору (см. getReviewEligibility) — условия проверяет
// сервер при каждом сохранении, фронтенд лишь рисует прогресс. Таблица и статусы — в миграции
// 0037_reviews.sql. Низкие оценки (1–3) и отзывы без согласия на публикацию остаются приватными
// (status 'private': видны только команде), публично показывается только status 'approved'.
import { pool } from "./db.js";
import { fireAndForget, notifyReviewSubmitted } from "./adminNotify.js";

export const REQUIRED_AI_REQUESTS = 5;
export const MIN_BODY = 30;
export const MAX_BODY = 1500;
export const MAX_REPLY = 800;
/** Оценки не выше этой в публичную ленту не попадают никогда */
export const MAX_PRIVATE_RATING = 3;

export class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Прогресс по трём условиям. Админам отзывы недоступны (они не пользователи сервиса). */
export async function getReviewEligibility(userId) {
  const { rows } = await pool.query(
    `select
       (p.onboarded_at is not null) as onboarding,
       exists (select 1 from public.diagnostics d where d.user_id = p.id) as diagnostic,
       (select count(*)::int from public.ai_messages m where m.user_id = p.id and m.role = 'user') as ai_messages,
       p.is_admin as is_admin
     from public.profiles p where p.id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return { eligible: false, onboarding: false, diagnostic: false, aiMessages: 0, required: REQUIRED_AI_REQUESTS, isAdmin: false };
  const aiMessages = Math.min(r.ai_messages, 9999);
  const eligible = !r.is_admin && r.onboarding && r.diagnostic && aiMessages >= REQUIRED_AI_REQUESTS;
  return { eligible, onboarding: r.onboarding, diagnostic: r.diagnostic, aiMessages, required: REQUIRED_AI_REQUESTS, isAdmin: r.is_admin };
}

const mapMine = (r) =>
  r && {
    rating: r.rating,
    body: r.body,
    subject: r.subject,
    displayName: r.display_name,
    consentPublic: r.consent_public,
    status: r.status,
    adminReply: r.admin_reply,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

/** «Анна Петрова» → «Анна П.»; пусто → «Ученик» */
export function defaultDisplayName(fullName) {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`.slice(0, 40);
}

/** Всё, что нужно экрану отзыва: допуск, свой отзыв (если есть), имя по умолчанию и предметы для выбора. */
export async function getMyReviewState(userId) {
  const [eligibility, rev, prof, subj] = await Promise.all([
    getReviewEligibility(userId),
    pool.query("select * from public.reviews where user_id = $1", [userId]),
    pool.query("select full_name from public.profiles where id = $1", [userId]),
    pool.query("select subject from public.profile_subjects where user_id = $1 order by added_at, subject", [userId]),
  ]);
  return {
    eligibility,
    review: mapMine(rev.rows[0]) ?? null,
    defaultName: defaultDisplayName(prof.rows[0]?.full_name),
    subjects: subj.rows.map((r) => r.subject),
  };
}

/** Статус, который получает сохранённый отзыв (создание и правка — одно правило). */
export function statusFor({ rating, consentPublic }) {
  return rating > MAX_PRIVATE_RATING && consentPublic ? "pending" : "private";
}

export async function saveMyReview(userId, input) {
  const eligibility = await getReviewEligibility(userId);
  if (!eligibility.eligible) throw new ReviewError("Отзыв можно оставить после онбординга, диагностики и 5 обращений к ИИ-репетитору.", 403);

  const rating = Number(input?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReviewError("Поставь оценку от 1 до 5.");
  const body = String(input?.body ?? "").trim();
  if (body.length < MIN_BODY) throw new ReviewError(`Напиши хотя бы ${MIN_BODY} символов — пара предложений о том, что помогло или чего не хватило.`);
  if (body.length > MAX_BODY) throw new ReviewError(`Отзыв длиннее ${MAX_BODY} символов — сократи его.`);
  const displayName = String(input?.displayName ?? "").trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 40) throw new ReviewError("Имя для подписи — от 2 до 40 символов (например, «Анна К.»).");
  const consentPublic = input?.consentPublic === true;

  let subject = input?.subject == null || input.subject === "" ? null : String(input.subject);
  if (subject) {
    const own = await pool.query("select 1 from public.profile_subjects where user_id = $1 and subject = $2", [userId, subject]);
    if (own.rowCount === 0) throw new ReviewError("Выбери один из своих предметов.");
  }

  const status = statusFor({ rating, consentPublic });
  const prev = (await pool.query("select rating, body, subject, display_name, consent_public from public.reviews where user_id = $1", [userId])).rows[0];
  // правка опубликованного отзыва возвращает его на модерацию (статус пересчитан выше); ответ команды
  // к изменённому тексту не относится — сбрасываем
  await pool.query(
    `insert into public.reviews (user_id, rating, body, subject, display_name, consent_public, status)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (user_id) do update set
       rating = excluded.rating, body = excluded.body, subject = excluded.subject, display_name = excluded.display_name,
       consent_public = excluded.consent_public, status = excluded.status,
       admin_reply = case when public.reviews.body is distinct from excluded.body then null else public.reviews.admin_reply end,
       published_at = null, updated_at = now()`,
    [userId, rating, body, subject, displayName, consentPublic, status]
  );
  const saved = (await getMyReviewState(userId)).review;
  // письмо команде — только если отзыв новый или что-то в нём реально изменилось (повторное «Сохранить» без правок не шумит)
  const changed = !prev || prev.rating !== rating || prev.body !== body || (prev.subject ?? null) !== subject || prev.display_name !== displayName || prev.consent_public !== consentPublic;
  if (changed) {
    const { rows } = await pool.query("select email from auth.users where id = $1", [userId]);
    fireAndForget(notifyReviewSubmitted({ review: saved, authorEmail: rows[0]?.email ?? "—", isEdit: !!prev }));
  }
  return saved;
}

export async function deleteMyReview(userId) {
  await pool.query("delete from public.reviews where user_id = $1", [userId]);
}

/** Публичная лента: только опубликованные, без user_id. */
export async function listPublicReviews(limit = 12) {
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  const { rows } = await pool.query(
    `select id, rating, body, subject, display_name, admin_reply, published_at
       from public.reviews where status = 'approved'
       order by published_at desc nulls last, created_at desc limit $1`,
    [n]
  );
  const agg = await pool.query(`select count(*)::int as count, round(avg(rating)::numeric, 1)::float as avg from public.reviews where status = 'approved'`);
  return {
    count: agg.rows[0].count,
    average: agg.rows[0].avg,
    reviews: rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, subject: r.subject, displayName: r.display_name, adminReply: r.admin_reply, publishedAt: r.published_at })),
  };
}

// ─────────────────────── админка ───────────────────────

export const ADMIN_STATUSES = ["pending", "private", "approved", "rejected"];

export async function listAdminReviews(status) {
  const where = ADMIN_STATUSES.includes(status) ? "where r.status = $1" : "";
  const { rows } = await pool.query(
    `select r.*, u.email from public.reviews r join auth.users u on u.id = r.user_id ${where}
      order by (r.status = 'pending') desc, r.updated_at desc limit 200`,
    where ? [status] : []
  );
  const counts = await pool.query("select status, count(*)::int as n from public.reviews group by status");
  const byStatus = Object.fromEntries(ADMIN_STATUSES.map((s) => [s, 0]));
  for (const c of counts.rows) byStatus[c.status] = c.n;
  return {
    counts: byStatus,
    reviews: rows.map((r) => ({ id: r.id, email: r.email, userId: r.user_id, ...mapMine(r) })),
  };
}

/** action: approve | reject | unpublish | reply (reply — текст ответа, пустой убирает ответ) */
export async function moderateReview(id, { action, reply }) {
  const { rows } = await pool.query("select * from public.reviews where id = $1", [id]);
  const r = rows[0];
  if (!r) throw new ReviewError("Отзыв не найден.", 404);

  if (action === "approve") {
    if (r.rating <= MAX_PRIVATE_RATING || !r.consent_public) throw new ReviewError("Этот отзыв публиковать нельзя: оценка 1–3 или нет согласия автора на публикацию.", 409);
    await pool.query("update public.reviews set status = 'approved', published_at = coalesce(published_at, now()) where id = $1", [id]);
  } else if (action === "reject") {
    await pool.query("update public.reviews set status = 'rejected', published_at = null where id = $1", [id]);
  } else if (action === "unpublish") {
    await pool.query("update public.reviews set status = 'pending', published_at = null where id = $1 and status = 'approved'", [id]);
  } else if (action === "reply") {
    const text = String(reply ?? "").trim();
    if (text.length > MAX_REPLY) throw new ReviewError(`Ответ длиннее ${MAX_REPLY} символов.`);
    await pool.query("update public.reviews set admin_reply = $2 where id = $1", [id, text || null]);
  } else {
    throw new ReviewError("Неизвестное действие.");
  }
  return (await listAdminReviews()).reviews.find((x) => x.id === id) ?? null;
}
