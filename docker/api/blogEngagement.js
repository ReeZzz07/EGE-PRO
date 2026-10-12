// Просмотры, лайки, репосты и комментарии под статьями блога (миграция 0044). Чистая логика над pool, без Express:
// проверки и тексты ошибок здесь, HTTP-обвязка — в server.js (роуты /blog-engagement/*).
//
// Кто что может: смотреть, лайкать, делиться и читать комментарии — любой посетитель; писать комментарии —
// только вошедший. Посетитель без входа — случайный идентификатор из его браузера, вошедший — аккаунт; в
// счётчики попадают только эти ключи, без почты и имени. Всё считается только по ОПУБЛИКОВАННЫМ статьям.
import { pool } from "./db.js";
import { assertCleanText } from "./contentFilter.js";

export const SHARE_CHANNELS = ["vk", "telegram", "whatsapp", "ok", "copy"];
export const COMMENT_MIN = 2;
export const COMMENT_MAX = 2000;
export const COMMENTS_PER_HOUR = 5;
export const COMMENTS_PAGE = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EngagementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Ключ посетителя: вошедший — по аккаунту, иначе по идентификатору из браузера. null — определить нельзя. */
export function viewerOf({ userId, visitorId }) {
  if (userId) return { key: `u:${userId}`, userId };
  if (typeof visitorId === "string" && UUID_RE.test(visitorId)) return { key: `v:${visitorId.toLowerCase()}`, userId: null };
  return null;
}

/** id опубликованной статьи по slug или null (черновик и несуществующая статья неотличимы). */
export async function publishedArticleId(slug) {
  const { rows } = await pool.query("select id from public.blog_articles where slug = $1 and is_published = true", [String(slug ?? "")]);
  return rows[0]?.id ?? null;
}

/** Просмотр: один на посетителя в день. Возвращает true, если засчитан новый. */
export async function recordView(articleId, viewer) {
  const { rowCount } = await pool.query(
    "insert into public.blog_article_views (article_id, viewer_key, user_id) values ($1, $2, $3) on conflict (article_id, viewer_key, viewed_on) do nothing",
    [articleId, viewer.key, viewer.userId]
  );
  return rowCount > 0;
}

/** Лайк: повторный запрос снимает. Возвращает { liked, likes }. */
export async function toggleLike(articleId, viewer) {
  const del = await pool.query("delete from public.blog_article_likes where article_id = $1 and viewer_key = $2", [articleId, viewer.key]);
  let liked = false;
  if (del.rowCount === 0) {
    await pool.query("insert into public.blog_article_likes (article_id, viewer_key, user_id) values ($1, $2, $3) on conflict do nothing", [articleId, viewer.key, viewer.userId]);
    liked = true;
  }
  const { rows } = await pool.query("select count(*)::int as n from public.blog_article_likes where article_id = $1", [articleId]);
  return { liked, likes: rows[0].n };
}

/** Репост: один на посетителя, канал и день. «copy» считается отдельно и в публичный счётчик не входит. */
export async function recordShare(articleId, viewer, channel) {
  if (!SHARE_CHANNELS.includes(channel)) throw new EngagementError("Неизвестный способ поделиться");
  const { rowCount } = await pool.query(
    "insert into public.blog_article_shares (article_id, viewer_key, user_id, channel) values ($1, $2, $3, $4) on conflict (article_id, viewer_key, channel, shared_on) do nothing",
    [articleId, viewer.key, viewer.userId, channel]
  );
  return rowCount > 0;
}

const COUNTS_SQL = `
  (select count(*)::int from public.blog_article_views v where v.article_id = a.id) as views,
  (select count(*)::int from public.blog_article_likes l where l.article_id = a.id) as likes,
  (select count(*)::int from public.blog_article_shares s where s.article_id = a.id and s.channel <> 'copy') as shares,
  (select count(*)::int from public.blog_comments c where c.article_id = a.id) as comments`;

/** Счётчики одной статьи и, если известен посетитель, поставил ли он лайк. */
export async function getStats(articleId, viewer = null) {
  const { rows } = await pool.query(`select ${COUNTS_SQL} from public.blog_articles a where a.id = $1`, [articleId]);
  if (!rows[0]) return null;
  let liked = false;
  if (viewer) liked = (await pool.query("select 1 from public.blog_article_likes where article_id = $1 and viewer_key = $2", [articleId, viewer.key])).rowCount > 0;
  return { ...rows[0], liked };
}

/** Просмотры, лайки и комментарии всех опубликованных статей — для карточек в списке: { slug: { views, likes, comments } }. */
export async function getAllStats() {
  const { rows } = await pool.query(`select a.slug, ${COUNTS_SQL} from public.blog_articles a where a.is_published = true`);
  return Object.fromEntries(rows.map((r) => [r.slug, { views: r.views, likes: r.likes, shares: r.shares, comments: r.comments }]));
}

const firstName = (full) => String(full ?? "").trim().split(/\s+/)[0] || null;

function shapeComment(r, me) {
  return {
    id: Number(r.id),
    // только имя без фамилии; у редакции — подпись, чтобы ответы команды было видно
    author: r.is_admin ? "Редакция ЕГЭ·ПРО" : firstName(r.full_name) ?? "Ученик",
    staff: !!r.is_admin,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
    mine: !!me && r.user_id === me,
  };
}

/** Комментарии: новые сверху, постранично (beforeId — курсор). me — id вошедшего (чтобы показать «удалить» у своих). */
export async function listComments(articleId, { beforeId, limit = COMMENTS_PAGE, me = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || COMMENTS_PAGE, 1), 100);
  const params = [articleId, lim + 1];
  let where = "c.article_id = $1";
  if (beforeId) {
    params.push(Number(beforeId));
    where += ` and c.id < $${params.length}`;
  }
  const { rows } = await pool.query(
    `select c.id, c.user_id, c.body, c.created_at, p.full_name, p.is_admin
       from public.blog_comments c join public.profiles p on p.id = c.user_id
      where ${where} order by c.id desc limit $2`,
    params
  );
  const more = rows.length > lim;
  const page = rows.slice(0, lim).map((r) => shapeComment(r, me));
  return { comments: page, nextBeforeId: more ? page[page.length - 1].id : null };
}

/** Новый комментарий (только вошедший). Фильтр слов и контактов — как у отзывов (цель «comments» в админке),
 *  не больше COMMENTS_PER_HOUR в час, дубль того же текста под той же статьёй за сутки не принимается. */
export async function addComment(articleId, userId, rawBody, ctx = {}) {
  if (!userId) throw new EngagementError("Войди в аккаунт, чтобы оставить комментарий", 401);
  const body = String(rawBody ?? "").replace(/\r\n/g, String.fromCharCode(10)).replace(new RegExp(String.fromCharCode(10) + "{3,}", "g"), String.fromCharCode(10).repeat(2)).trim();
  if (body.length < COMMENT_MIN) throw new EngagementError("Комментарий слишком короткий");
  if (body.length > COMMENT_MAX) throw new EngagementError(`Комментарий слишком длинный: не больше ${COMMENT_MAX} символов`);

  const recent = await pool.query("select count(*)::int as n from public.blog_comments where user_id = $1 and created_at > now() - interval '1 hour'", [userId]);
  if (recent.rows[0].n >= COMMENTS_PER_HOUR) throw new EngagementError("Слишком много комментариев за час — подожди немного", 429);
  const dup = await pool.query("select 1 from public.blog_comments where user_id = $1 and article_id = $2 and body = $3 and created_at > now() - interval '1 day'", [userId, articleId, body]);
  if (dup.rowCount > 0) throw new EngagementError("Такой комментарий ты уже оставлял");

  await assertCleanText({ comment: body }, "comments", { userId, ip: ctx.ip });

  const { rows } = await pool.query("insert into public.blog_comments (article_id, user_id, body) values ($1, $2, $3) returning id", [articleId, userId, body]);
  const saved = await pool.query(
    "select c.id, c.user_id, c.body, c.created_at, p.full_name, p.is_admin from public.blog_comments c join public.profiles p on p.id = c.user_id where c.id = $1",
    [rows[0].id]
  );
  return shapeComment(saved.rows[0], userId);
}

/** Удалить комментарий: свой — автор, любой — админ. Возвращает true, если удалён. */
export async function deleteComment(commentId, { userId, isAdmin }) {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id < 1) return false;
  const { rowCount } = await pool.query("delete from public.blog_comments where id = $1 and ($2::boolean or user_id = $3)", [id, !!isAdmin, userId]);
  return rowCount > 0;
}

/** Для админки: последние комментарии по всем статьям (с заголовком статьи), включая черновики. */
export async function listRecentCommentsAdmin(limit = 50) {
  const { rows } = await pool.query(
    `select c.id, c.body, c.created_at, c.user_id, p.full_name, p.is_admin, u.email, a.slug, a.title
       from public.blog_comments c
       join public.blog_articles a on a.id = c.article_id
       join public.profiles p on p.id = c.user_id
       join auth.users u on u.id = c.user_id
      order by c.id desc limit $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
    author: r.is_admin ? "Редакция ЕГЭ·ПРО" : firstName(r.full_name) ?? "Ученик",
    email: r.email,
    articleSlug: r.slug,
    articleTitle: r.title,
  }));
}

/** Для админки: счётчики по всем статьям (включая черновики): { articleId: { views, likes, shares, comments } }. */
export async function getAllStatsAdmin() {
  const { rows } = await pool.query(`select a.id, ${COUNTS_SQL} from public.blog_articles a`);
  return Object.fromEntries(rows.map((r) => [r.id, { views: r.views, likes: r.likes, shares: r.shares, comments: r.comments }]));
}
