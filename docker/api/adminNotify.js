// Уведомления администраторам: о новых отзывах (письмо на почту отзывов, по умолчанию info@ege-tutor.ru —
// НЕ на support@, куда уходят только обращения), значки «что требует внимания» в админке и ежедневная сводка.
//
//  • notifyReviewSubmitted — сразу после того, как ученик отправил/изменил отзыв: на модерацию (оценка 4–5 с
//    согласием) или «только для команды» (оценка 1–3 или нет согласия на публикацию — это обратная связь);
//  • сводка по обращениям (раз в сутки утром по Москве, если есть без ответа / просроченные / не ушедшие
//    письма) — на почту поддержки; сводка по отзывам (ждут модерации) — на почту отзывов;
//  • getAdminBadges — числа для значков на вкладках «Обращения» и «Отзывы» и на пункте «Админка».
// Адрес для отзывов хранится рядом с остальными контактами (public.app_settings, ключ 'contacts',
// поле reviewNotifyEmail) и правится в /admin → Обращения → Контакты и каналы.
import { pool } from "./db.js";
import { escapeHtml, sendMail } from "./mailer.js";
import { resolveContactSettings, TOPICS, REPLY_WITHIN_HOURS } from "./feedback.js";

// Тесты подменяют отправку, чтобы не слать настоящие письма
let send = sendMail;
export function setNotifySenderForTests(fn) {
  send = fn ?? sendMail;
}

// Письма уходят «в фоне» (ответ пользователю не ждёт SMTP); тесты дожидаются их через whenNotificationsSettled
const inflight = new Set();
export function fireAndForget(promise) {
  inflight.add(promise);
  promise.finally(() => inflight.delete(promise));
  return promise;
}
export const whenNotificationsSettled = () => Promise.allSettled([...inflight]);

// ─────────────────────── новый отзыв ───────────────────────

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

/** Тема и пометка письма по статусу отзыва, который получился после сохранения. */
export function describeReview(review) {
  const who = review.displayName;
  if (review.status === "pending") return { subject: `Новый отзыв на модерации — ${review.rating}★ ${who}`, note: "Ждёт модерации: Админка → Отзывы → «На модерации»." };
  if (review.rating <= 3) return { subject: `Отзыв с оценкой ${review.rating}★ (только для команды) — ${who}`, note: "Оценка 1–3 на сайте не публикуется — это обратная связь, стоит разобраться, что не так." };
  return { subject: `Отзыв ${review.rating}★ без согласия на публикацию — ${who}`, note: "Автор не разрешил публикацию — отзыв виден только команде." };
}

/** Письмо о сохранённом отзыве на почту отзывов. Не бросает: уведомление не должно ронять сохранение. */
export async function notifyReviewSubmitted({ review, authorEmail, isEdit }) {
  try {
    const settings = await resolveContactSettings();
    const { subject, note } = describeReview(review);
    const rows = [
      ["Оценка", `${stars(review.rating)} (${review.rating} из 5)`],
      ["Подпись", review.displayName],
      ["Автор (почта)", authorEmail],
      ...(review.subject ? [["Предмет", review.subject]] : []),
      ["Согласие на публикацию", review.consentPublic ? "да" : "нет"],
      ["Статус", review.status],
    ];
    await send({
      to: settings.reviewNotifyEmail,
      subject: `${isEdit ? "Изменён: " : ""}${subject}`,
      text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${review.body}\n\n${note}`,
      html: `<!doctype html><html lang="ru"><body style="font-family:sans-serif;color:#15172e;max-width:560px;margin:0 auto;padding:20px 16px;"><table cellpadding="4" style="font-size:14px;">${rows
        .map(([k, v]) => `<tr><td style="color:#8a8d9a;">${escapeHtml(k)}</td><td><b>${escapeHtml(String(v))}</b></td></tr>`)
        .join("")}</table><p style="white-space:pre-wrap;font-size:15px;border-left:4px solid #2447e9;padding:6px 12px;margin:16px 0;">${escapeHtml(review.body)}</p><p style="font-size:12px;color:#8a8d9a;">${escapeHtml(note)}</p></body></html>`,
    });
    console.log(`[reviews] уведомление об отзыве отправлено на ${settings.reviewNotifyEmail}: ${review.status}, ${review.rating}★`);
    return true;
  } catch (e) {
    console.warn("[reviews] уведомление об отзыве не ушло:", String(e?.message ?? e).slice(0, 300));
    return false;
  }
}

// ─────────────────────── значки в админке ───────────────────────

export async function getAdminBadges() {
  const { rows } = await pool.query(
    `select
       (select count(*)::int from public.feedback_messages where status = 'new') as feedback_new,
       (select count(*)::int from public.feedback_messages m
         where m.status in ('new','in_progress') and m.first_response_at is null and m.created_at < now() - interval '${REPLY_WITHIN_HOURS} hours') as feedback_overdue,
       (select count(*)::int from public.feedback_messages
         where team_notified_at is null and team_notify_error is not null) as feedback_delivery_failed,
       (select count(*)::int from public.reviews where status = 'pending') as reviews_pending`
  );
  const r = rows[0];
  return {
    feedbackNew: r.feedback_new,
    feedbackOverdue: r.feedback_overdue,
    feedbackDeliveryFailed: r.feedback_delivery_failed,
    reviewsPending: r.reviews_pending,
    // что показать цифрой: на «Обращения» — новые (просроченные среди них уже учтены, если без ответа), на «Отзывы» — ждущие модерации
    total: r.feedback_new + r.reviews_pending,
  };
}

// ─────────────────────── ежедневная сводка ───────────────────────

const DIGEST_FROM_HOUR = 9; // по Москве
const DIGEST_TO_HOUR = 21;
const DIGEST_KEY = "admin_digest";

const moscow = (now) => ({
  date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now),
  hour: Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).format(now)),
});

const ago = (iso) => {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн назад`;
};

async function buildFeedbackDigest() {
  const { rows: open } = await pool.query(
    `select m.id, m.topic, m.email, m.status, m.created_at,
            (m.first_response_at is null and m.created_at < now() - interval '${REPLY_WITHIN_HOURS} hours') as overdue, left(m.message, 100) as snippet
       from public.feedback_messages m
      where m.status in ('new','in_progress') and m.first_response_at is null
      order by m.created_at limit 200`
  );
  const failed = (await pool.query("select count(*)::int as n from public.feedback_messages where team_notified_at is null and team_notify_error is not null")).rows[0].n;
  if (open.length === 0 && failed === 0) return null;
  const overdue = open.filter((r) => r.overdue);
  const lines = open.slice(0, 15).map((r) => `• №${r.id} · ${TOPICS[r.topic] ?? r.topic} · ${r.email} · ${ago(r.created_at)}${r.overdue ? " · ПРОСРОЧЕНО" : ""}\n  ${r.snippet}`);
  const head = [`Без ответа: ${open.length}${overdue.length ? ` (просрочено больше ${REPLY_WITHIN_HOURS} ч: ${overdue.length})` : ""}`, ...(failed ? [`Письмо команде не ушло: ${failed} (смотрите журнал: фильтр «Письмо не ушло»)`] : [])];
  const text = `${head.join("\n")}\n\n${lines.join("\n")}${open.length > 15 ? `\n… и ещё ${open.length - 15}` : ""}\n\nАдминка → Обращения.`;
  const html = `<!doctype html><html lang="ru"><body style="font-family:sans-serif;color:#15172e;max-width:600px;margin:0 auto;padding:20px 16px;"><p style="font-size:15px;"><b>${head.map(escapeHtml).join("<br>")}</b></p>${open
    .slice(0, 15)
    .map(
      (r) =>
        `<p style="margin:10px 0;font-size:14px;"><b>№${r.id}</b> · ${escapeHtml(TOPICS[r.topic] ?? r.topic)} · ${escapeHtml(r.email)} · ${escapeHtml(ago(r.created_at))}${r.overdue ? ' · <b style="color:#e03a26;">ПРОСРОЧЕНО</b>' : ""}<br><span style="color:#6b6e7c;">${escapeHtml(r.snippet)}</span></p>`
    )
    .join("")}${open.length > 15 ? `<p>… и ещё ${open.length - 15}</p>` : ""}<p style="font-size:12px;color:#8a8d9a;">Админка → Обращения.</p></body></html>`;
  return { subject: `Обращения без ответа: ${open.length}${overdue.length ? `, просрочено ${overdue.length}` : ""}${failed ? `, письма не ушли ${failed}` : ""}`, text, html };
}

async function buildReviewsDigest() {
  const { rows } = await pool.query(
    `select r.rating, r.display_name, r.updated_at, left(r.body, 120) as snippet from public.reviews r where r.status = 'pending' order by r.updated_at limit 100`
  );
  if (rows.length === 0) return null;
  const lines = rows.slice(0, 15).map((r) => `• ${stars(r.rating)} ${r.display_name} · ${ago(r.updated_at)}\n  ${r.snippet}`);
  const text = `Отзывов ждёт модерации: ${rows.length}\n\n${lines.join("\n")}${rows.length > 15 ? `\n… и ещё ${rows.length - 15}` : ""}\n\nАдминка → Отзывы.`;
  const html = `<!doctype html><html lang="ru"><body style="font-family:sans-serif;color:#15172e;max-width:600px;margin:0 auto;padding:20px 16px;"><p style="font-size:15px;"><b>Отзывов ждёт модерации: ${rows.length}</b></p>${rows
    .slice(0, 15)
    .map((r) => `<p style="margin:10px 0;font-size:14px;"><b>${escapeHtml(stars(r.rating))}</b> ${escapeHtml(r.display_name)} · ${escapeHtml(ago(r.updated_at))}<br><span style="color:#6b6e7c;">${escapeHtml(r.snippet)}</span></p>`)
    .join("")}${rows.length > 15 ? `<p>… и ещё ${rows.length - 15}</p>` : ""}<p style="font-size:12px;color:#8a8d9a;">Админка → Отзывы.</p></body></html>`;
  return { subject: `Отзывы на модерации: ${rows.length}`, text, html };
}

async function readState() {
  const { rows } = await pool.query("select value from public.app_settings where key = $1", [DIGEST_KEY]);
  return rows[0]?.value ?? {};
}
async function writeState(patch) {
  const next = { ...(await readState()), ...patch };
  await pool.query(
    `insert into public.app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
    [DIGEST_KEY, JSON.stringify(next)]
  );
}

/**
 * Раз в сутки (после 9:00 по Москве) шлёт сводки — отдельно по обращениям (на почту поддержки) и по отзывам
 * (на почту отзывов), и только если есть о чём сообщить. День помечается «сделан» после успешной отправки или
 * когда сообщать нечего; при сбое отправки следующий прогон (через 15 минут) попробует снова.
 */
export async function runAdminDigests({ now = new Date(), ignoreWindow = false } = {}) {
  const { date, hour } = moscow(now);
  const result = { feedback: false, reviews: false };
  if (!ignoreWindow && (hour < DIGEST_FROM_HOUR || hour >= DIGEST_TO_HOUR)) return result;
  const state = await readState();
  const settings = await resolveContactSettings();

  if (state.feedbackDate !== date) {
    try {
      const d = await buildFeedbackDigest();
      if (d) {
        await send({ via: "support", to: settings.supportEmail, subject: d.subject, text: d.text, html: d.html });
        result.feedback = true;
        console.log(`[digest] сводка по обращениям отправлена на ${settings.supportEmail}`);
      }
      await writeState({ feedbackDate: date });
    } catch (e) {
      console.warn("[digest] сводка по обращениям не ушла:", String(e?.message ?? e).slice(0, 300));
    }
  }
  if (state.reviewsDate !== date) {
    try {
      const d = await buildReviewsDigest();
      if (d) {
        await send({ to: settings.reviewNotifyEmail, subject: d.subject, text: d.text, html: d.html });
        result.reviews = true;
        console.log(`[digest] сводка по отзывам отправлена на ${settings.reviewNotifyEmail}`);
      }
      await writeState({ reviewsDate: date });
    } catch (e) {
      console.warn("[digest] сводка по отзывам не ушла:", String(e?.message ?? e).slice(0, 300));
    }
  }
  return result;
}

export function startAdminDigestScheduler() {
  if (process.env.LIFECYCLE_EMAILS === "off") return;
  const tick = () => runAdminDigests().catch((e) => console.warn("[digest] сбой прогона:", e?.message ?? e));
  setTimeout(tick, 3 * 60 * 1000).unref();
  setInterval(tick, 15 * 60 * 1000).unref();
}
