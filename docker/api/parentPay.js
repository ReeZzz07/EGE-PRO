// «Попросить родителя оплатить»: у школьников часто нет своей карты, поэтому ученик отправляет родителю
// ссылку /pay-for/<токен> (мессенджером или письмом с нашего адреса), а родитель без входа в аккаунт
// выбирает тариф и платит картой или через СБП. Платёж записывается на аккаунт ученика (тариф включается
// ему), чек уходит родителю. Миграция 0041_parent_pay.sql; сам платёж — payments.js (initiatePayment).
//
// Безопасность: по ссылке можно только оплатить тариф этому ученику и увидеть его имя и два счётчика
// (решённых заданий, пройдена ли диагностика). Ссылка живёт 14 дней. Письма родителю — только по
// действию ученика, не чаще раза в час, не больше трёх в сутки и трёх на один адрес; адрес хранится
// хешем (нужен только для лимитов), в письме сказано, как отказаться.
import crypto from "node:crypto";
import { pool } from "./db.js";
import { initiatePayment, getPaymentStatus, getPaymentSummary, priceWithDiscount, effectiveDiscountPercent } from "./payments.js";
import { getWelcomeOffer } from "./offers.js";
import { sendMail, escapeHtml, wrapBrandedHtml } from "./mailer.js";
import { emailProblem, normalizeEmail } from "./validators.js";

export const LINK_TTL_DAYS = 14;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const SHARE_CHANNELS = ["copy", "whatsapp", "telegram", "email", "other"];
const MAX_EMAILS_PER_DAY = 3;
const MAX_EMAILS_PER_ADDRESS = 3;
const EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

const hashEmail = (email) => crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");

export function isValidToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** Имя для обращения к ученику в письме и на странице: первое слово из ФИО; нет имени — null. */
export function firstName(fullName) {
  const w = String(fullName ?? "").trim().split(/\s+/)[0];
  return w ? w.slice(0, 40) : null;
}

export function linkUrl(siteUrl, token) {
  return `${siteUrl}/pay-for/${token}`;
}

async function logEvent(linkId, kind, channel = null) {
  await pool.query("insert into public.parent_link_events (link_id, kind, channel) values ($1, $2, $3)", [linkId, kind, channel]);
}

/** Действующая ссылка ученика или новая. Одна живая на ученика: повторное нажатие «Попросить родителя»
 *  даёт ту же ссылку, а не плодит новые. */
export async function getOrCreateLink(userId) {
  const cur = await pool.query(
    "select id, token, expires_at from public.parent_links where user_id = $1 and expires_at > now() + interval '1 day' order by created_at desc limit 1",
    [userId]
  );
  if (cur.rows[0]) return { id: cur.rows[0].id, token: cur.rows[0].token, expiresAt: cur.rows[0].expires_at, created: false };
  const token = crypto.randomBytes(24).toString("base64url");
  const { rows } = await pool.query(
    "insert into public.parent_links (user_id, token, expires_at) values ($1, $2, now() + ($3 || ' days')::interval) returning id, expires_at",
    [userId, token, String(LINK_TTL_DAYS)]
  );
  await logEvent(rows[0].id, "created");
  return { id: rows[0].id, token, expiresAt: rows[0].expires_at, created: true };
}

/** Ученик поделился ссылкой (скопировал, открыл WhatsApp/Telegram) — для статистики в админке. */
export async function recordShare(userId, channel) {
  const ch = SHARE_CHANNELS.includes(channel) ? channel : "other";
  const link = await getOrCreateLink(userId);
  await logEvent(link.id, "shared", ch);
}

async function findLink(token) {
  if (!isValidToken(token)) return null;
  const { rows } = await pool.query(
    `select l.id, l.user_id, l.expires_at, (l.expires_at > now()) as active, p.full_name, p.is_admin, p.anonymized_at, p.tariff_id, p.discount_percent
       from public.parent_links l join public.profiles p on p.id = l.user_id
      where l.token = $1`,
    [token]
  );
  const r = rows[0];
  if (!r || r.anonymized_at) return null;
  return r;
}

async function studentStats(userId) {
  const { rows } = await pool.query(
    `select (select count(*) from public.attempts where user_id = $1)::int as tasks,
            exists(select 1 from public.diagnostics where user_id = $1) as diagnostic`,
    [userId]
  );
  return { tasksSolved: rows[0]?.tasks ?? 0, diagnosticDone: !!rows[0]?.diagnostic };
}

/** Платные тарифы с итоговыми ценами для этого ученика (персональная скидка и приветственный оффер
 *  не суммируются — берётся большая, ровно как при самой оплате в payments.js). */
async function tariffQuotes(userId, personalDiscount) {
  const offer = await getWelcomeOffer(userId);
  const percent = effectiveDiscountPercent(personalDiscount, offer);
  const { rows } = await pool.query(
    `select id, name, badge, price_rub, sale_price_rub, subjects_count, daily_ai_limit, features
       from public.tariffs where is_active and price_rub > 0 order by sort_order, price_rub`
  );
  return {
    discountPercent: percent,
    discountUntil: offer?.active ? offer.expiresAt : null,
    tariffs: rows.map((t) => {
      const base = Number(t.sale_price_rub ?? t.price_rub);
      return {
        id: t.id,
        name: t.name,
        badge: t.badge,
        basePrice: base,
        finalPrice: priceWithDiscount(base, percent),
        subjectsCount: t.subjects_count,
        dailyAiLimit: t.daily_ai_limit,
        features: Array.isArray(t.features) ? t.features : [],
      };
    }),
  };
}

/** Что показываем родителю на публичной странице. null — ссылки нет, { expired: true } — истекла. */
export async function getPublicView(token) {
  const link = await findLink(token);
  if (!link) return null;
  if (!link.active) return { expired: true };
  const recent = await pool.query("select 1 from public.parent_link_events where link_id = $1 and kind = 'opened' and created_at > now() - interval '30 minutes' limit 1", [link.id]);
  if (!recent.rows[0]) await logEvent(link.id, "opened");
  const [stats, quotes] = await Promise.all([studentStats(link.user_id), tariffQuotes(link.user_id, link.discount_percent)]);
  return {
    expired: false,
    studentName: firstName(link.full_name),
    expiresAt: link.expires_at,
    currentTariffId: link.tariff_id,
    ...stats,
    ...quotes,
  };
}

/** Платёж родителя: тариф включится ученику, чек уйдёт на email родителя. */
export async function startParentPayment(token, { tariffId, email, method }, siteUrl) {
  const link = await findLink(token);
  if (!link) return { error: "Ссылка не найдена" };
  if (!link.active) return { error: "Срок действия ссылки истёк — попросите ребёнка отправить новую" };
  const parentEmail = normalizeEmail(email);
  const problem = emailProblem(parentEmail);
  if (problem) return { error: problem };
  const result = await initiatePayment(link.user_id, String(tariffId ?? ""), siteUrl, {
    method,
    parentLinkId: link.id,
    customerEmail: parentEmail,
    returnUrlFor: (paymentId) => `${linkUrl(siteUrl, token)}?paymentId=${paymentId}`,
  });
  if (result.error) return result;
  await logEvent(link.id, "pay_started");
  return { paymentId: result.paymentId, confirmationUrl: result.confirmationUrl };
}

/** Статус платежа, начатого по ссылке: ссылку знает только родитель, поэтому чужой платёж так не прочитать. */
export async function getParentPaymentStatus(token, paymentId) {
  const link = await findLink(token);
  if (!link) return null;
  const own = await pool.query("select 1 from public.payments where id = $1 and parent_link_id = $2", [paymentId, link.id]);
  if (!own.rows[0]) return null;
  const status = await getPaymentStatus(paymentId, link.user_id, false);
  if (!status) return null;
  const summary = status === "succeeded" ? await getPaymentSummary(paymentId) : null;
  return { status, ...(summary ?? {}), studentName: firstName(link.full_name) };
}

const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Письмо родителю: кто просит, что за сервис, прогресс ученика, кнопка на страницу оплаты. */
export function buildParentEmail({ studentName, url, stats, siteUrl }) {
  const who = studentName ?? "Ваш ребёнок";
  const subject = studentName ? `${studentName} просит помочь оплатить подготовку к ЕГЭ` : "Ваш ребёнок просит помочь оплатить подготовку к ЕГЭ";
  const progress = [];
  if (stats?.tasksSolved > 0) progress.push(`решено ${stats.tasksSolved} ${plural(stats.tasksSolved, "задание", "задания", "заданий")}`);
  if (stats?.diagnosticDone) progress.push("пройдена диагностика уровня");
  const progressText = progress.length ? `Уже сделано: ${progress.join(", ")}.` : "";
  const facts = [
    "Оплата разовая, на 30 дней — автопродления нет, карту мы не сохраняем.",
    "Можно оплатить картой или через СБП, чек придёт на вашу почту.",
    "Тариф включается ребёнку сразу после оплаты.",
  ];
  const text = [
    `${who} занимается на ЕГЭ·ПРО — тренажёре для подготовки к ЕГЭ с ИИ-репетитором, который объясняет задачи по шагам, а не решает за ученика. Просит вас помочь с оплатой тарифа.`,
    progressText,
    `Посмотреть тарифы и оплатить (ссылка действует ${LINK_TTL_DAYS} дней):\n${url}`,
    facts.map((f) => `— ${f}`).join("\n"),
    "Письмо отправлено по просьбе вашего ребёнка. Если оно пришло по ошибке — просто проигнорируйте его. Чтобы мы больше не писали на этот адрес, ответьте на письмо словом «стоп».",
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = wrapBrandedHtml(
    `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">просьба об оплате</p>
<h2 style="margin:0 0 14px;font-size:21px;">${escapeHtml(who)} просит помочь с оплатой подготовки к ЕГЭ</h2>
<div style="margin:0 0 12px;font-size:14.5px;line-height:1.6;">ЕГЭ·ПРО — тренажёр для подготовки к ЕГЭ с ИИ-репетитором: он объясняет задачи по шагам, а не решает за ученика. Задания — из открытого банка ФИПИ.</div>
${progressText ? `<div style="margin:0 0 12px;font-size:14.5px;line-height:1.6;"><strong>${escapeHtml(progressText)}</strong></div>` : ""}
<p style="margin:20px 0 6px;"><a href="${escapeHtml(url)}" style="background:#2447e9;color:#f4f6ff;padding:13px 24px;text-decoration:none;font-weight:700;font-size:15px;border:2px solid #101b5e;display:inline-block;">Посмотреть тарифы и оплатить</a></p>
<ul style="margin:16px 0 0;padding:0 0 0 18px;font-size:13.5px;line-height:1.6;color:#3b3f66;">${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
<p style="margin:14px 0 0;font-size:12px;color:#8a8d9a;">Ссылка действует ${LINK_TTL_DAYS} дней. Если кнопка не работает, скопируйте адрес в браузер:<br><span style="word-break:break-all;">${escapeHtml(url)}</span></p>
`,
    siteUrl,
    "Письмо отправлено по просьбе вашего ребёнка. Если оно пришло по ошибке — просто проигнорируйте его; ответьте «стоп», и мы больше не напишем на этот адрес."
  );
  return { subject, text, html };
}

/** Письмо родителю от имени ученика. Ошибки — понятным текстом для ученика. */
export async function sendParentEmail(userId, rawEmail, siteUrl) {
  const email = normalizeEmail(rawEmail);
  const problem = emailProblem(email);
  if (problem) return { error: problem };

  const own = await pool.query("select email, (select full_name from public.profiles where id = $1) as full_name from auth.users where id = $1", [userId]);
  if (!own.rows[0]) return { error: "Аккаунт не найден" };
  if (normalizeEmail(own.rows[0].email) === email) return { error: "Это твой собственный адрес — укажи почту родителя" };

  const hash = hashEmail(email);
  const [recent, perAddress] = await Promise.all([
    pool.query("select max(sent_at) as last, count(*) filter (where sent_at > now() - interval '24 hours')::int as day from public.parent_email_log where user_id = $1", [userId]),
    pool.query("select count(*)::int as n from public.parent_email_log where email_hash = $1", [hash]),
  ]);
  const last = recent.rows[0]?.last ? new Date(recent.rows[0].last).getTime() : 0;
  if (Date.now() - last < EMAIL_COOLDOWN_MS) return { error: "Письмо родителю уже отправлено — подожди час, прежде чем отправить ещё. Ссылку можно скопировать и переслать самому." };
  if ((recent.rows[0]?.day ?? 0) >= MAX_EMAILS_PER_DAY) return { error: "Сегодня уже отправлено три письма — завтра можно снова. Ссылку можно скопировать и переслать самому." };
  if ((perAddress.rows[0]?.n ?? 0) >= MAX_EMAILS_PER_ADDRESS) return { error: "На этот адрес мы уже отправляли письма — лучше перешли ссылку сам(а)." };

  const link = await getOrCreateLink(userId);
  const stats = await studentStats(userId);
  const mail = buildParentEmail({ studentName: firstName(own.rows[0].full_name), url: linkUrl(siteUrl, link.token), stats, siteUrl });
  try {
    await sendMail({ to: email, ...mail, via: "support" });
  } catch (e) {
    await logEvent(link.id, "email_failed", "email");
    console.warn("не удалось отправить письмо родителю:", e?.message ?? e);
    return { error: "Не получилось отправить письмо — скопируй ссылку и перешли её родителю сам(а)." };
  }
  await pool.query("insert into public.parent_email_log (user_id, email_hash) values ($1, $2)", [userId, hash]);
  await logEvent(link.id, "email_sent", "email");
  return { ok: true };
}

/** Статистика для админки: сколько ссылок создано, как ими делились, открыли, начали платить, заплатили. */
export async function getParentPayStats({ from, to } = {}) {
  const params = [];
  const where = ["true"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from ?? "")) {
    params.push(from);
    where.push(`e.created_at >= $${params.length}::date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
    params.push(to);
    where.push(`e.created_at < ($${params.length}::date + 1)`);
  }
  const w = where.join(" and ");
  const ev = (
    await pool.query(
      `select count(distinct e.link_id) filter (where e.kind = 'created')::int as created,
              count(distinct e.link_id) filter (where e.kind = 'shared')::int as shared,
              count(*) filter (where e.kind = 'shared' and e.channel = 'copy')::int as shared_copy,
              count(*) filter (where e.kind = 'shared' and e.channel = 'whatsapp')::int as shared_whatsapp,
              count(*) filter (where e.kind = 'shared' and e.channel = 'telegram')::int as shared_telegram,
              count(*) filter (where e.kind = 'email_sent')::int as emails_sent,
              count(*) filter (where e.kind = 'email_failed')::int as emails_failed,
              count(distinct e.link_id) filter (where e.kind = 'opened')::int as opened,
              count(distinct e.link_id) filter (where e.kind = 'pay_started')::int as pay_started
         from public.parent_link_events e where ${w}`,
      params
    )
  ).rows[0];
  const pay = (
    await pool.query(
      `select count(*)::int as paid, coalesce(sum(amount_rub), 0)::float as revenue
         from public.payments where parent_link_id is not null and status = 'succeeded'`
    )
  ).rows[0];
  return { ...ev, paid: pay.paid, revenue: pay.revenue };
}
