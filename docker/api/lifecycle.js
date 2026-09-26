// Одноразовые «жизненные» письма, которые уходят сами (без действий админа):
//  • activation_d1 — через сутки после подтверждения почты тому, кто так и не решил ни одного
//    задания и не сделал диагностику (воронка показала: до первого результата доходит ~10%);
//  • plan_nudge — через сутки после диагностики тому, кто увидел свой план (и пейволл на его
//    экране), но так и не оплатил — раньше после этого момента с человеком никто не связывался
//    вовсе (см. разбор воронки 26.09.2026: 11 реальных пользователей дошли до плана, ни один не
//    получил ни одного письма);
//  • payment_abandoned — тому, кто начал оплату тарифа, но не довёл её до конца;
//  • expiring:<дата> / expired:<дата> — платному пользователю за 3 дня до окончания тарифа и в первые
//    3 дня после: со ссылкой /renew на продление «как было» (дата в виде — чтобы следующий
//    оплаченный период снова получил свои напоминания, а не упирался в старую строку журнала).
// Каждое письмо — максимум один раз на человека (первичный ключ lifecycle_emails, см. миграцию
// 0028): строку-«заявку» пишем ДО отправки, поэтому даже перезапуск/двойной запуск планировщика не
// продублирует письмо; цена этого — при сбое SMTP письмо не повторяется (лучше потерять напоминание,
// чем засыпать человека копиями). Отключить целиком — переменная окружения LIFECYCLE_EMAILS=off.
import { pool } from "./db.js";
import { sendActivationEmail, sendPlanNudgeEmail, sendPaymentAbandonedEmail, sendSubscriptionExpiryEmail } from "./lifecycleEmails.js";
import { getSubscription } from "./subscription.js";
import { getWelcomeOffer } from "./offers.js";

// Только для текста письма (не для логики предмета нигде больше в backend) — те же названия, что в
// src/data/tasks.ts SUBJECTS[...].name, но этот файл фронтенду не доступен напрямую из docker/api.
const SUBJECT_NAMES = {
  math: "Математика (профиль)",
  rus: "Русский язык",
  inf: "Информатика",
  fiz: "Физика",
  soc: "Обществознание",
  bio: "Биология",
  eng: "Английский язык",
  geo: "География",
  chem: "Химия",
  hist: "История",
  lit: "Литература",
  math_base: "Математика (базовый уровень)",
};

const BATCH = 30;
const TICK_MS = 15 * 60 * 1000;
// не пишем людям ночью: окно по Москве (аудитория — российские школьники)
const QUIET_FROM_HOUR = 9;
const QUIET_TO_HOUR = 21;

function inSendingWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).format(now));
  return hour >= QUIET_FROM_HOUR && hour < QUIET_TO_HOUR;
}

/** Заявка на отправку: true — этот вызов первым занял пару (пользователь, вид) и должен слать письмо. */
async function claim(userId, kind) {
  const { rowCount } = await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, $2) on conflict do nothing", [userId, kind]);
  return rowCount === 1;
}

export async function findActivationCandidates(limit = BATCH) {
  const { rows } = await pool.query(
    `select u.id, u.email, p.full_name
     from auth.users u join public.profiles p on p.id = u.id
     where u.email_confirmed_at between now() - interval '5 days' and now() - interval '20 hours'
       and not p.is_admin and p.tariff_id = 'free'
       and u.email not like '%.local'
       and not exists (select 1 from public.attempts a where a.user_id = u.id)
       and not exists (select 1 from public.diagnostics d where d.user_id = u.id)
       and not exists (select 1 from public.lifecycle_emails l where l.user_id = u.id and l.kind = 'activation_d1')
     order by u.email_confirmed_at
     limit $1`,
    [limit]
  );
  return rows;
}

/** Дошёл до диагностики (и, значит, видел пейволл на экране «План подготовки» — см. PlanView.tsx),
 *  но за сутки-пять так и не заплатил. Берём САМУЮ ПОЗДНЮЮ диагностику каждого — она и определяет
 *  окно отправки (то же окно, что у activation_d1 — 20 часов – 5 дней), и её тема/слабые места идут
 *  в текст письма (если делал несколько — по последней). */
export async function findPlanNudgeCandidates(limit = BATCH) {
  const { rows } = await pool.query(
    `with latest as (
       select distinct on (d.user_id) d.user_id, d.subject, d.result, d.finished_at
       from public.diagnostics d
       order by d.user_id, d.finished_at desc
     )
     select u.id, u.email, p.full_name, l.subject, l.result
     from latest l
       join auth.users u on u.id = l.user_id
       join public.profiles p on p.id = u.id
     where l.finished_at between now() - interval '5 days' and now() - interval '20 hours'
       and not p.is_admin and p.tariff_id = 'free'
       and u.email not like '%.local'
       and not exists (select 1 from public.lifecycle_emails el where el.user_id = u.id and el.kind = 'plan_nudge')
     order by l.finished_at
     limit $1`,
    [limit]
  );
  return rows;
}

export async function findAbandonedPaymentCandidates(limit = BATCH) {
  const { rows } = await pool.query(
    `select distinct on (u.id) u.id, u.email, p.full_name, t.name as tariff_name, pay.kind
     from public.payments pay
       join auth.users u on u.id = pay.user_id
       join public.profiles p on p.id = u.id
       join public.tariffs t on t.id = pay.tariff_id
     where pay.status in ('pending', 'canceled')
       and pay.created_at between now() - interval '3 days' and now() - interval '1 hour'
       and not p.is_admin
       -- «бросил первую покупку тарифа» — только пока тариф так и не куплен ни разу (p.tariff_id
       -- ещё free). Продление/докупку это условие раньше ошибочно тоже требовало p.tariff_id = 'free',
       -- из-за чего эти письма никогда не уходили уже оплатившим — у них tariff_id ВСЕГДА не free.
       and (pay.kind <> 'tariff' or p.tariff_id = 'free')
       and u.email not like '%.local'
       and not exists (select 1 from public.payments ok where ok.user_id = u.id and ok.status = 'succeeded' and ok.kind = pay.kind)
       and not exists (select 1 from public.lifecycle_emails l where l.user_id = u.id and l.kind = 'payment_abandoned')
     order by u.id, pay.created_at desc
     limit $1`,
    [limit]
  );
  return rows;
}


/** Платные тарифы, срок которых закончится в ближайшие 3 дня (expired=false) или закончился не
 *  более 3 дней назад (expired=true). kind включает дату окончания — см. шапку файла. */
export async function findExpiryCandidates(expired, limit = BATCH) {
  const { rows } = await pool.query(
    `select u.id, u.email, p.full_name, p.tariff_expires_at,
            (case when $1 then 'expired:' else 'expiring:' end) || to_char(p.tariff_expires_at at time zone 'UTC', 'YYYY-MM-DD') as kind
     from public.profiles p join auth.users u on u.id = p.id
     where not p.is_admin and p.tariff_id <> 'free' and p.tariff_expires_at is not null
       and u.email not like '%.local'
       and (case when $1 then p.tariff_expires_at between now() - interval '3 days' and now()
                 else p.tariff_expires_at between now() and now() + interval '3 days' end)
       and not exists (
         select 1 from public.lifecycle_emails l
         where l.user_id = u.id
           and l.kind = (case when $1 then 'expired:' else 'expiring:' end) || to_char(p.tariff_expires_at at time zone 'UTC', 'YYYY-MM-DD'))
     order by p.tariff_expires_at
     limit $2`,
    [expired, limit]
  );
  return rows;
}

async function sendExpiryBatch(expired, siteUrl) {
  let sent = 0;
  for (const c of await findExpiryCandidates(expired)) {
    if (!(await claim(c.id, c.kind))) continue;
    try {
      const sub = await getSubscription(c.id);
      if (!sub?.renewal) continue;
      await sendSubscriptionExpiryEmail(c.email, {
        fullName: c.full_name,
        siteUrl,
        tariffName: sub.renewal.tariffName,
        expiresAt: sub.expiresAt ?? c.tariff_expires_at,
        expired,
        daysLeft: sub.daysLeft,
        extraSubjects: sub.renewal.extraSubjects,
        amountRub: sub.renewal.amountRub,
        frozenCount: sub.frozenSubjects.length,
      });
      sent++;
    } catch (e) {
      console.warn(`не удалось отправить письмо о сроке тарифа (${c.kind}):`, e?.message ?? e);
    }
  }
  return sent;
}

export async function runLifecycleEmails({ ignoreQuietHours = false } = {}) {
  if (!ignoreQuietHours && !inSendingWindow()) return { activation: 0, planNudge: 0, abandoned: 0, expiry: 0 };
  const siteUrl = (process.env.CORS_ORIGIN || "").split(",")[0].trim();
  const sent = { activation: 0, planNudge: 0, abandoned: 0, expiry: 0 };

  for (const c of await findActivationCandidates()) {
    if (!(await claim(c.id, "activation_d1"))) continue;
    try {
      await sendActivationEmail(c.email, { fullName: c.full_name, siteUrl, offer: await getWelcomeOffer(c.id) });
      sent.activation++;
    } catch (e) {
      console.warn("не удалось отправить письмо-напоминание (activation_d1):", e?.message ?? e);
    }
  }

  for (const c of await findPlanNudgeCandidates()) {
    if (!(await claim(c.id, "plan_nudge"))) continue;
    try {
      const weakTopics = Array.isArray(c.result?.weakTopics) ? c.result.weakTopics : [];
      await sendPlanNudgeEmail(c.email, {
        fullName: c.full_name,
        siteUrl,
        subjectName: SUBJECT_NAMES[c.subject] ?? c.subject,
        weakTopics,
        offer: await getWelcomeOffer(c.id),
      });
      sent.planNudge++;
    } catch (e) {
      console.warn("не удалось отправить письмо-напоминание про план (plan_nudge):", e?.message ?? e);
    }
  }

  for (const c of await findAbandonedPaymentCandidates()) {
    if (!(await claim(c.id, "payment_abandoned"))) continue;
    try {
      await sendPaymentAbandonedEmail(c.email, { fullName: c.full_name, siteUrl, tariffName: c.tariff_name, kind: c.kind, offer: await getWelcomeOffer(c.id) });
      sent.abandoned++;
    } catch (e) {
      console.warn("не удалось отправить письмо о брошенной оплате:", e?.message ?? e);
    }
  }

  sent.expiry = (await sendExpiryBatch(false, siteUrl)) + (await sendExpiryBatch(true, siteUrl));

  if (sent.activation || sent.planNudge || sent.abandoned || sent.expiry)
    console.log(`[lifecycle] отправлено: напоминаний ${sent.activation}, про план ${sent.planNudge}, о брошенной оплате ${sent.abandoned}, о сроке тарифа ${sent.expiry}`);
  return sent;
}

export function startLifecycleScheduler() {
  if (process.env.LIFECYCLE_EMAILS === "off") {
    console.log("[lifecycle] отключено (LIFECYCLE_EMAILS=off)");
    return;
  }
  const tick = () => runLifecycleEmails().catch((e) => console.warn("[lifecycle] сбой прогона:", e?.message ?? e));
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
}
