// Обратная связь: форма на /contacts, журнал обращений, ответы из админки. См. миграцию 0038_feedback.sql.
//
// Порядок: обращение СНАЧАЛА записывается в БД (+ событие «created» + строка в логе сервера), и только
// потом уходят письма (команде на адрес поддержки и подтверждение автору) — упавший SMTP ничего не
// теряет, а результат каждой отправки виден в журнале обращения. Контакты и каналы связи (почта,
// WhatsApp, Telegram, VK) — в public.app_settings, ключ 'contacts', правятся в /admin → Обращения.
import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { EMAIL_RE, normalizeEmail } from "./validators.js";
import { escapeHtml, sendMail, wrapBrandedHtml, resolveSupportSmtpSettings } from "./mailer.js";

// Тесты подменяют отправку, чтобы не слать настоящие письма (см. test/feedback.test.js)
let send = sendMail;
export function setMailSenderForTests(fn) {
  send = fn ?? sendMail;
}

export const TOPICS = {
  payment: "Оплата и тарифы",
  bug: "Проблема с работой сайта",
  task_error: "Ошибка в задании",
  suggestion: "Предложение",
  partnership: "Сотрудничество",
  other: "Другое",
};
export const STATUSES = ["new", "in_progress", "answered", "closed"];
export const STATUS_LABEL = { new: "Новое", in_progress: "В работе", answered: "Отвечено", closed: "Закрыто" };

/** Обещанный срок ответа — на странице, в письме автору и в отметке «просрочено» в админке */
export const REPLY_WITHIN_HOURS = 24;
export const MIN_MESSAGE = 10;
export const MAX_MESSAGE = 3000;
const MAX_REPLY = 5000;
const MAX_NOTE = 2000;
/** Не больше стольких обращений в час с одного адреса / почты / аккаунта */
export const HOURLY_LIMIT = 5;
/** Быстрее этого человек форму не заполнит — так отсеиваем ботов (молча делаем вид, что приняли) */
const MIN_FILL_MS = 3000;

export const DEFAULT_SUPPORT_EMAIL = "support@ege-tutor.ru";

/** Каналы связи: порядок = порядок на странице. Ссылку задаёт админ; разрешены только свои домены. */
export const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", hosts: ["wa.me", "api.whatsapp.com", "whatsapp.com", "chat.whatsapp.com"] },
  { id: "telegram", label: "Telegram", hosts: ["t.me", "telegram.me"] },
  { id: "vk", label: "ВКонтакте", hosts: ["vk.com", "m.vk.com", "vk.me", "vk.ru"] },
];

/** Тема во ВСЕХ письмах по обращению (команде, подтверждение автору, ответы, ответ из почтового клиента) —
 *  одна и та же, поэтому у автора и у поддержки они складываются в одну цепочку. Ответ — «Re: » + эта тема. */
export const subjectFor = (m) => `[Обращение №${m.id}] ${TOPICS[m.topic] ?? m.topic}`;

export class FeedbackError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ─────────────────────── настройки контактов ───────────────────────

function validChannelUrl(channel, raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  return channel.hosts.includes(host) ? u.toString() : null;
}

/** Читает и очищает сохранённое: мусор → дефолт, канал без валидной ссылки считается выключенным. */
export async function resolveContactSettings() {
  let saved = {};
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'contacts'");
    saved = rows[0]?.value ?? {};
  } catch (e) {
    console.warn("не удалось прочитать contacts из app_settings, использую дефолты:", e?.message ?? e);
  }
  const email = normalizeEmail(saved.supportEmail);
  const channels = {};
  for (const ch of CHANNELS) {
    const url = validChannelUrl(ch, saved.channels?.[ch.id]?.url);
    channels[ch.id] = { enabled: !!url && saved.channels?.[ch.id]?.enabled !== false, url: url ?? "" };
  }
  return { supportEmail: EMAIL_RE.test(email) ? email : DEFAULT_SUPPORT_EMAIL, channels };
}

/** Что видит посетитель страницы /contacts: только включённые каналы, без служебного. */
export async function getPublicContactInfo() {
  const s = await resolveContactSettings();
  return {
    supportEmail: s.supportEmail,
    replyWithinHours: REPLY_WITHIN_HOURS,
    topics: Object.entries(TOPICS).map(([id, label]) => ({ id, label })),
    channels: CHANNELS.filter((c) => s.channels[c.id].enabled).map((c) => ({ id: c.id, label: c.label, url: s.channels[c.id].url })),
  };
}

export async function saveContactSettings(input, adminId) {
  const email = normalizeEmail(input?.supportEmail);
  if (!EMAIL_RE.test(email)) throw new FeedbackError("Укажи корректный адрес почты поддержки.");
  const channels = {};
  for (const ch of CHANNELS) {
    const raw = String(input?.channels?.[ch.id]?.url ?? "").trim();
    const enabled = input?.channels?.[ch.id]?.enabled === true;
    if (raw && !validChannelUrl(ch, raw)) throw new FeedbackError(`${ch.label}: ссылка должна начинаться с https:// и вести на ${ch.hosts.join(" / ")}.`);
    if (enabled && !raw) throw new FeedbackError(`${ch.label}: включён, но ссылка не указана.`);
    channels[ch.id] = { enabled, url: raw ? validChannelUrl(ch, raw) : "" };
  }
  const value = { supportEmail: email, channels };
  await pool.query(
    `insert into public.app_settings (key, value, updated_by) values ('contacts', $1, $2)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`,
    [JSON.stringify(value), adminId ?? null]
  );
  return resolveContactSettings();
}

// ─────────────────────── приём обращения ───────────────────────

export const hashIp = (ip) => (ip ? createHash("sha256").update(`feedback|${ip}`).digest("hex").slice(0, 32) : null);

async function addEvent(feedbackId, type, data = {}, actorId = null, db = pool) {
  await db.query("insert into public.feedback_events (feedback_id, type, actor_id, data) values ($1, $2, $3, $4)", [feedbackId, type, actorId, JSON.stringify(data)]);
}

/**
 * Принимает обращение. input: { topic, name, email, message, consent, taskId, source, website (ловушка),
 * elapsedMs }; ctx: { userId, ip, userAgent }. Для вошедшего пользователя почта берётся из аккаунта.
 * Возвращает { id, saved } — saved:false, если это бот (ловушка/слишком быстро): ему отвечаем «принято».
 */
export async function createFeedback(input, ctx = {}) {
  if (String(input?.website ?? "").trim() !== "" || (Number(input?.elapsedMs) > 0 && Number(input.elapsedMs) < MIN_FILL_MS)) {
    console.log(`[feedback] отсеяно как бот (ip ${hashIp(ctx.ip)?.slice(0, 8) ?? "-"})`);
    return { id: null, saved: false };
  }

  const topic = String(input?.topic ?? "");
  if (!(topic in TOPICS)) throw new FeedbackError("Выбери тему обращения.");
  const message = String(input?.message ?? "").trim();
  if (message.length < MIN_MESSAGE) throw new FeedbackError(`Опиши вопрос подробнее — хотя бы ${MIN_MESSAGE} символов.`);
  if (message.length > MAX_MESSAGE) throw new FeedbackError(`Сообщение длиннее ${MAX_MESSAGE} символов — сократи его.`);
  if (input?.consent !== true) throw new FeedbackError("Нужно согласие на обработку данных, чтобы мы могли ответить.");
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || null;

  let email = normalizeEmail(input?.email);
  const context = { userAgent: String(ctx.userAgent ?? "").slice(0, 300) };
  if (ctx.userId) {
    const { rows } = await pool.query("select u.email, p.tariff_id from auth.users u join public.profiles p on p.id = u.id where u.id = $1", [ctx.userId]);
    if (rows[0]) {
      email = rows[0].email;
      context.tariff = rows[0].tariff_id;
    }
  }
  if (!EMAIL_RE.test(email)) throw new FeedbackError("Укажи корректную почту — на неё придёт ответ.");

  const ipHash = hashIp(ctx.ip);
  const { rows: recent } = await pool.query(
    `select count(*)::int as n from public.feedback_messages
      where created_at > now() - interval '1 hour' and (email = $1 or ($2::text is not null and ip_hash = $2) or ($3::uuid is not null and user_id = $3))`,
    [email, ipHash, ctx.userId ?? null]
  );
  if (recent[0].n >= HOURLY_LIMIT) throw new FeedbackError("Слишком много обращений за час. Мы уже получили ваши сообщения — ответим по очереди.", 429);

  const source = String(input?.source ?? "").slice(0, 200) || null;
  const taskId = String(input?.taskId ?? "").slice(0, 80) || null;
  const { rows } = await pool.query(
    `insert into public.feedback_messages (user_id, email, name, topic, message, task_id, source, context, ip_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [ctx.userId ?? null, email, name, topic, message, taskId, source, JSON.stringify(context), ipHash]
  );
  const id = rows[0].id;
  await addEvent(id, "created", { topic, source, loggedIn: !!ctx.userId });
  console.log(`[feedback] #${id} создано: тема ${topic}${ctx.userId ? `, пользователь ${ctx.userId}` : ", гость"}`);
  return { id, saved: true };
}

// ─────────────────────── письма ───────────────────────

function infoRows(m) {
  return [
    ["Номер", `№${m.id}`],
    ["Тема", TOPICS[m.topic] ?? m.topic],
    ["Имя", m.name || "—"],
    ["Почта", m.email],
    ...(m.task_id ? [["Задание", m.task_id]] : []),
    ...(m.context?.tariff ? [["Тариф", m.context.tariff]] : []),
    ...(m.source ? [["Страница", m.source]] : []),
  ];
}

/** Письма по новому обращению: команде и подтверждение автору. Результат каждого — в журнале. Не бросает. */
export async function dispatchFeedbackEmails(id, { siteUrl = "" } = {}) {
  const { rows } = await pool.query("select * from public.feedback_messages where id = $1", [id]);
  const m = rows[0];
  if (!m) return;
  const settings = await resolveContactSettings();
  const base = siteUrl || "https://ege-tutor.ru";

  try {
    const lines = infoRows(m).map(([k, v]) => `${k}: ${v}`).join("\n");
    const sentTeam = await send({
      via: "support",
      to: settings.supportEmail,
      replyTo: m.email,
      subject: subjectFor(m),
      text: `${lines}\n\n${m.message}\n\nОтветить можно прямо на это письмо — ответ уйдёт автору. Статус и история — в админке (Обращения → №${m.id}).`,
      html: `<!doctype html><html lang="ru"><body style="font-family:sans-serif;color:#15172e;max-width:560px;margin:0 auto;padding:20px 16px;"><table cellpadding="4" style="font-size:14px;">${infoRows(m)
        .map(([k, v]) => `<tr><td style="color:#8a8d9a;">${escapeHtml(k)}</td><td><b>${escapeHtml(v)}</b></td></tr>`)
        .join("")}</table><p style="white-space:pre-wrap;font-size:15px;border-left:4px solid #2447e9;padding:6px 12px;margin:16px 0;">${escapeHtml(m.message)}</p><p style="font-size:12px;color:#8a8d9a;">Ответить можно прямо на это письмо — ответ уйдёт автору. Статус и история — в админке (Обращения → №${m.id}).</p></body></html>`,
    });
    await pool.query("update public.feedback_messages set team_notified_at = now(), team_notify_error = null where id = $1", [id]);
    await addEvent(id, "team_notified", { to: settings.supportEmail, from: sentTeam?.from });
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await pool.query("update public.feedback_messages set team_notify_error = $2 where id = $1", [id, msg]).catch(() => {});
    await addEvent(id, "team_notify_failed", { error: msg }).catch(() => {});
    console.warn(`[feedback] #${id}: письмо команде не ушло:`, msg);
  }

  try {
    const days = REPLY_WITHIN_HOURS === 24 ? "в течение одного дня" : `в течение ${REPLY_WITHIN_HOURS} часов`;
    const intro = `Мы получили твоё обращение №${m.id} («${TOPICS[m.topic] ?? m.topic}») и ответим ${days} на этот адрес.`;
    const sentAck = await send({
      via: "support",
      to: m.email,
      replyTo: settings.supportEmail,
      subject: subjectFor(m),
      text: `${intro}\n\nТвоё сообщение:\n${m.message}\n\nЕсли хочешь что-то добавить — просто ответь на это письмо.`,
      html: wrapBrandedHtml(
        `<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">обращение №${m.id}</p>
<h2 style="margin:0 0 18px;font-size:21px;">Мы получили твоё сообщение</h2>
<div style="margin:0 0 14px;">${escapeHtml(intro)}</div>
<p style="white-space:pre-wrap;font-size:14px;border-left:4px solid #2447e9;padding:6px 12px;margin:0 0 14px;">${escapeHtml(m.message)}</p>
<div style="margin:0;">Если хочешь что-то добавить — просто ответь на это письмо.</div>`,
        base,
        "Это автоматическое подтверждение — мы пишем его один раз на каждое обращение."
      ),
    });
    await pool.query("update public.feedback_messages set ack_sent_at = now(), ack_error = null where id = $1", [id]);
    await addEvent(id, "ack_sent", { to: m.email, from: sentAck?.from });
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await pool.query("update public.feedback_messages set ack_error = $2 where id = $1", [id, msg]).catch(() => {});
    await addEvent(id, "ack_failed", { error: msg }).catch(() => {});
    console.warn(`[feedback] #${id}: подтверждение автору не ушло:`, msg);
  }
}

// ─────────────────────── обращения пользователя ───────────────────────

export async function listMyFeedback(userId) {
  const { rows } = await pool.query(
    `select m.id, m.topic, m.message, m.status, m.created_at,
            coalesce((select json_agg(json_build_object('text', e.data->>'text', 'at', e.created_at) order by e.id)
                        from public.feedback_events e where e.feedback_id = m.id and e.type = 'reply_sent'), '[]'::json) as replies
       from public.feedback_messages m where m.user_id = $1 order by m.id desc limit 50`,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, topic: r.topic, message: r.message, status: r.status, createdAt: r.created_at, replies: r.replies }));
}

// ─────────────────────── админка ───────────────────────

const OVERDUE_SQL = `(m.status in ('new','in_progress') and m.first_response_at is null and m.created_at < now() - interval '${REPLY_WITHIN_HOURS} hours')`;
const SORTS = {
  created: "m.created_at",
  updated: "m.updated_at",
  status: "array_position(array['new','in_progress','answered','closed'], m.status)",
  topic: "m.topic",
  id: "m.id",
};

const mapRow = (r) => ({
  id: r.id,
  userId: r.user_id,
  email: r.email,
  name: r.name,
  topic: r.topic,
  message: r.message,
  taskId: r.task_id,
  source: r.source,
  context: r.context,
  status: r.status,
  adminNote: r.admin_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  firstResponseAt: r.first_response_at,
  closedAt: r.closed_at,
  teamNotified: r.team_notified_at ? "ok" : r.team_notify_error ? "failed" : "pending",
  teamNotifyError: r.team_notify_error,
  ackSent: r.ack_sent_at ? "ok" : r.ack_error ? "failed" : "pending",
  ackError: r.ack_error,
  overdue: !!r.overdue,
});

/**
 * Список с фильтрами и сортировкой. Фильтры: status (один из STATUSES или "open" = new+in_progress),
 * topic, q (почта/имя/текст/№), from/to (YYYY-MM-DD, по дате создания), overdue ("1"), delivery ("failed" —
 * хотя бы одно письмо не ушло). sort: created|updated|status|topic|id, dir: asc|desc. page с 1.
 */
export async function listFeedback(f = {}) {
  const where = [];
  const params = [];
  const p = (v) => (params.push(v), `$${params.length}`);
  if (f.status === "open") where.push("m.status in ('new','in_progress')");
  else if (STATUSES.includes(f.status)) where.push(`m.status = ${p(f.status)}`);
  if (f.topic in TOPICS) where.push(`m.topic = ${p(f.topic)}`);
  if (f.q && String(f.q).trim()) {
    const q = String(f.q).trim();
    const like = p(`%${q.replace(/[%_\\]/g, "\\$&")}%`);
    const idMatch = /^#?(\d{1,9})$/.exec(q);
    where.push(`(m.email ilike ${like} or m.name ilike ${like} or m.message ilike ${like}${idMatch ? ` or m.id = ${p(Number(idMatch[1]))}` : ""})`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from ?? "")) where.push(`m.created_at >= ${p(f.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to ?? "")) where.push(`m.created_at < (${p(f.to)}::date + 1)`);
  if (f.overdue === "1" || f.overdue === true) where.push(OVERDUE_SQL);
  if (f.delivery === "failed") where.push("(m.team_notify_error is not null and m.team_notified_at is null or m.ack_error is not null and m.ack_sent_at is null)");

  const sort = SORTS[f.sort] ?? SORTS.created;
  const dir = f.dir === "asc" ? "asc" : "desc";
  const pageSize = Math.max(5, Math.min(100, Number(f.pageSize) || 20));
  const page = Math.max(1, Number(f.page) || 1);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const { rows } = await pool.query(
    `select m.*, ${OVERDUE_SQL} as overdue from public.feedback_messages m ${whereSql}
      order by ${sort} ${dir}, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params
  );
  const total = (await pool.query(`select count(*)::int as n from public.feedback_messages m ${whereSql}`, params)).rows[0].n;

  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of (await pool.query("select status, count(*)::int as n from public.feedback_messages group by status")).rows) counts[c.status] = c.n;
  const overdue = (await pool.query(`select count(*)::int as n from public.feedback_messages m where ${OVERDUE_SQL}`)).rows[0].n;

  return { items: rows.map(mapRow), total, page, pageSize, counts, overdue };
}

export async function getFeedbackDetail(id) {
  const { rows } = await pool.query(`select m.*, ${OVERDUE_SQL} as overdue from public.feedback_messages m where m.id = $1`, [id]);
  if (!rows[0]) throw new FeedbackError("Обращение не найдено.", 404);
  const events = (
    await pool.query(
      `select e.id, e.type, e.data, e.created_at, u.email as actor_email
         from public.feedback_events e left join auth.users u on u.id = e.actor_id
        where e.feedback_id = $1 order by e.id`,
      [id]
    )
  ).rows.map((e) => ({ id: e.id, type: e.type, data: e.data, createdAt: e.created_at, actor: e.actor_email }));
  return { ...mapRow(rows[0]), events };
}

/** Смена статуса и/или заметки. Каждое изменение — событие в журнале (кто и что поменял). */
export async function updateFeedback(id, adminId, { status, note }) {
  const { rows } = await pool.query("select status, admin_note from public.feedback_messages where id = $1", [id]);
  const cur = rows[0];
  if (!cur) throw new FeedbackError("Обращение не найдено.", 404);

  if (status !== undefined && status !== cur.status) {
    if (!STATUSES.includes(status)) throw new FeedbackError("Неизвестный статус.");
    await pool.query(
      `update public.feedback_messages set status = $2, updated_at = now(), closed_at = case when $2 = 'closed' then now() else null end where id = $1`,
      [id, status]
    );
    await addEvent(id, "status_changed", { from: cur.status, to: status }, adminId);
  }
  if (note !== undefined) {
    const text = String(note ?? "").trim();
    if (text.length > MAX_NOTE) throw new FeedbackError(`Заметка длиннее ${MAX_NOTE} символов.`);
    if (text !== (cur.admin_note ?? "")) {
      await pool.query("update public.feedback_messages set admin_note = $2, updated_at = now() where id = $1", [id, text || null]);
      await addEvent(id, "note_changed", { text }, adminId);
    }
  }
  return getFeedbackDetail(id);
}

/** Ответ автору письмом с адреса сервиса (Reply-To — почта поддержки). Не ушло — в журнале «reply_failed», ошибка админу. */
export async function replyFeedback(id, adminId, text) {
  const body = String(text ?? "").trim();
  if (body.length < 2) throw new FeedbackError("Напиши текст ответа.");
  if (body.length > MAX_REPLY) throw new FeedbackError(`Ответ длиннее ${MAX_REPLY} символов.`);
  const { rows } = await pool.query("select * from public.feedback_messages where id = $1", [id]);
  const m = rows[0];
  if (!m) throw new FeedbackError("Обращение не найдено.", 404);
  if (!EMAIL_RE.test(m.email)) throw new FeedbackError("Адрес автора удалён (аккаунт удалён) — отвечать некуда.", 409);

  const settings = await resolveContactSettings();
  let sentReply;
  try {
    sentReply = await send({
      via: "support",
      to: m.email,
      replyTo: settings.supportEmail,
      subject: `Re: ${subjectFor(m)}`,
      text: `${body}\n\n— — —\nТвоё обращение №${m.id}:\n${m.message}`,
      html: wrapBrandedHtml(
        `<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">ответ на обращение №${m.id}</p>
<p style="white-space:pre-wrap;font-size:15px;margin:0 0 18px;">${escapeHtml(body)}</p>
<p style="white-space:pre-wrap;font-size:13px;color:#6b6e7c;border-left:4px solid #d7d9e0;padding:4px 12px;margin:0;">${escapeHtml(m.message)}</p>`,
        "https://ege-tutor.ru",
        "Можно просто ответить на это письмо — оно придёт нам."
      ),
    });
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 300);
    await addEvent(id, "reply_failed", { error: msg, text: body }, adminId).catch(() => {});
    throw new FeedbackError(`Письмо не отправилось: ${msg}`, 502);
  }
  await addEvent(id, "reply_sent", { text: body, to: m.email, from: sentReply?.from }, adminId);
  await pool.query(
    `update public.feedback_messages set updated_at = now(), first_response_at = coalesce(first_response_at, now()),
            status = case when status = 'closed' then status else 'answered' end where id = $1`,
    [id]
  );
  return getFeedbackDetail(id);
}

// ─────────────────────── отправитель писем поддержки ───────────────────────
// Подтверждения, ответы из админки и письма команде уходят с адреса поддержки, а не с noreply@: для этого у
// поддержки свой SMTP-ящик (ключ 'smtp_support'). Пароль наружу не отдаём — только факт, что он задан.

export async function getSupportSender() {
  const { rows } = await pool.query("select value from public.app_settings where key = 'smtp_support'");
  const v = rows[0]?.value ?? {};
  const resolved = await resolveSupportSmtpSettings();
  return {
    host: v.host ?? "smtp.yandex.ru",
    port: Number(v.port) || 465,
    secure: v.secure !== false,
    user: v.user ?? "",
    fromName: v.fromName ?? "ЕГЭ·ПРО — поддержка",
    fromAddress: v.fromAddress ?? "",
    hasPassword: !!v.password,
    // с какого адреса письма поддержки реально уйдут сейчас
    effectiveFrom: resolved?.settings.fromAddress ?? null,
    dedicated: !!resolved?.dedicated,
  };
}

export async function saveSupportSender(input, adminId) {
  const host = String(input?.host ?? "").trim();
  const user = normalizeEmail(input?.user);
  const port = Number(input?.port);
  if (!host) throw new FeedbackError("Укажи SMTP-сервер, например smtp.yandex.ru.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new FeedbackError("Порт — число от 1 до 65535 (для Яндекса 465).");
  if (!EMAIL_RE.test(user)) throw new FeedbackError("Логин — полный адрес ящика поддержки, например support@ege-tutor.ru.");
  const fromAddress = normalizeEmail(input?.fromAddress) || user;
  if (!EMAIL_RE.test(fromAddress)) throw new FeedbackError("Адрес отправителя указан неверно.");
  const fromName = String(input?.fromName ?? "").trim().slice(0, 80) || "ЕГЭ·ПРО — поддержка";

  const { rows } = await pool.query("select value from public.app_settings where key = 'smtp_support'");
  const password = String(input?.password ?? "") || rows[0]?.value?.password || "";
  if (!password) throw new FeedbackError("Укажи пароль приложения для ящика поддержки.");

  const value = { host, port, secure: input?.secure !== false, user, password, fromName, fromAddress };
  await pool.query(
    `insert into public.app_settings (key, value, updated_by) values ('smtp_support', $1, $2)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`,
    [JSON.stringify(value), adminId ?? null]
  );
  return getSupportSender();
}

/** Тестовое письмо «от поддержки» — чтобы проверить настройки, не создавая обращений. */
export async function sendSupportSenderTest(to) {
  const addr = normalizeEmail(to);
  if (!EMAIL_RE.test(addr)) throw new FeedbackError("Укажи адрес, на который отправить тест.");
  try {
    const r = await send({
      via: "support",
      to: addr,
      subject: "Тест: письма поддержки ЕГЭ·ПРО",
      text: "Это тестовое письмо. Если вы видите его от адреса поддержки — ответы на обращения будут уходить с этого же адреса.",
    });
    return { from: r?.from ?? null, dedicated: r?.dedicated ?? null };
  } catch (e) {
    throw new FeedbackError(`Письмо не отправилось: ${String(e?.message ?? e).slice(0, 300)}`, 502);
  }
}
