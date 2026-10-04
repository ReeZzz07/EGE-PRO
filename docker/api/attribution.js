// Атрибуция регистраций: откуда пришёл человек (метки рекламы, реферер) и отчёт «источник → воронка → оплаты».
// Метки собирает клиент (src/lib/attribution.ts) и присылает при регистрации; здесь они проверяются и сохраняются
// в public.signup_attribution (миграция 0040). Ошибка сохранения меток никогда не должна ломать регистрацию.
import { pool } from "./db.js";

const ALLOWED = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "yclid", "gclid", "referrer", "landing", "at"];
const MAX_LEN = 120;

/** Очищает одно касание: только известные поля, строки до 120 символов без управляющих символов. */
export function sanitizeTouch(t) {
  if (!t || typeof t !== "object") return null;
  const out = {};
  for (const k of ALLOWED) {
    const v = t[k];
    if (typeof v !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const clean = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LEN);
    if (clean) out[k] = clean;
  }
  return Object.keys(out).length ? out : null;
}

/** { first, last } из тела запроса → то, что кладём в БД (или null, если присланное пусто). */
export function sanitizeAttribution(input) {
  const first = sanitizeTouch(input?.first);
  const last = sanitizeTouch(input?.last) ?? first;
  if (!first && !last) return null;
  return { first: first ?? last, last: last ?? first };
}

export async function saveSignupAttribution(userId, input) {
  const a = sanitizeAttribution(input);
  if (!a) return false;
  await pool.query(
    `insert into public.signup_attribution (user_id, first_touch, last_touch) values ($1, $2, $3)
     on conflict (user_id) do nothing`,
    [userId, JSON.stringify(a.first), JSON.stringify(a.last)]
  );
  return true;
}

const MARKS = ["utm_source", "utm_campaign", "utm_medium", "yclid", "gclid"];
/** Канал и кампания человека: по последнему размеченному заходу, иначе по первому. Используется и в отчёте (SQL ниже повторяет правило). */
export function channelOf(attr) {
  if (!attr) return { channel: "нет данных (до внедрения)", campaign: "—" };
  const marked = (t) => t && MARKS.some((k) => t[k]);
  const t = marked(attr.last_touch) ? attr.last_touch : attr.first_touch;
  const channel = t?.utm_source ? String(t.utm_source).toLowerCase() : t?.yclid ? "yandex (yclid)" : t?.gclid ? "google (gclid)" : t?.referrer ? `ref: ${t.referrer}` : "прямой заход";
  return { channel, campaign: t?.utm_campaign || "—" };
}

/**
 * Отчёт: по каналу и кампании — регистрации, подтвердили почту, прошли онбординг, диагностику, сделали хоть
 * одно действие, оплатили (человек + сумма). from/to — YYYY-MM-DD по дате регистрации (включительно).
 * Тестовые адреса (.local) и администраторы не считаются.
 */
export async function getAttributionReport({ from, to } = {}) {
  const params = [];
  const where = ["not p.is_admin", "u.email not like '%.local'", "p.anonymized_at is null"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from ?? "")) {
    params.push(from);
    where.push(`u.created_at >= $${params.length}::date`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
    params.push(to);
    where.push(`u.created_at < ($${params.length}::date + 1)`);
  }
  const w = where.join(" and ");

  const rows = (
    await pool.query(
      `with base as (
         select u.id, u.email_confirmed_at, p.onboarded_at,
                case when a.user_id is null then null
                     when a.last_touch ?| array['utm_source','utm_campaign','utm_medium','yclid','gclid'] then a.last_touch
                     else a.first_touch end as t,
                (a.user_id is not null) as has_attr
         from auth.users u join public.profiles p on p.id = u.id left join public.signup_attribution a on a.user_id = u.id
         where ${w}
       ), cls as (
         select b.*,
                case when not has_attr then 'нет данных (до внедрения)'
                     when nullif(t->>'utm_source','') is not null then lower(t->>'utm_source')
                     when t ? 'yclid' then 'yandex (yclid)'
                     when t ? 'gclid' then 'google (gclid)'
                     when nullif(t->>'referrer','') is not null then 'ref: ' || (t->>'referrer')
                     else 'прямой заход' end as channel,
                coalesce(nullif(t->>'utm_campaign',''), '—') as campaign
         from base b
       )
       select c.channel, c.campaign,
              count(*)::int as regs,
              count(*) filter (where c.email_confirmed_at is not null)::int as confirmed,
              count(*) filter (where c.onboarded_at is not null)::int as onboarded,
              count(*) filter (where exists (select 1 from public.diagnostics d where d.user_id = c.id))::int as diagnostic,
              count(*) filter (where exists (select 1 from public.attempts x where x.user_id = c.id)
                                   or exists (select 1 from public.ai_messages m where m.user_id = c.id)
                                   or exists (select 1 from public.diagnostics d where d.user_id = c.id))::int as active,
              count(*) filter (where exists (select 1 from public.payments pay where pay.user_id = c.id and pay.status = 'succeeded'))::int as paid,
              coalesce(sum((select sum(pay.amount_rub) from public.payments pay where pay.user_id = c.id and pay.status = 'succeeded')), 0)::float as revenue
         from cls c group by 1, 2 order by regs desc, channel, campaign`,
      params
    )
  ).rows;

  const domains = (
    await pool.query(
      `select split_part(u.email, '@', 2) as domain, count(*)::int as regs, count(*) filter (where u.email_confirmed_at is not null)::int as confirmed
         from auth.users u join public.profiles p on p.id = u.id where ${w}
        group by 1 having count(*) >= 3 order by regs desc limit 12`,
      params
    )
  ).rows;

  const total = rows.reduce(
    (a, r) => ({ regs: a.regs + r.regs, confirmed: a.confirmed + r.confirmed, onboarded: a.onboarded + r.onboarded, diagnostic: a.diagnostic + r.diagnostic, active: a.active + r.active, paid: a.paid + r.paid, revenue: a.revenue + r.revenue }),
    { regs: 0, confirmed: 0, onboarded: 0, diagnostic: 0, active: 0, paid: 0, revenue: 0 }
  );
  return { rows, domains, total };
}
