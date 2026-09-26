// Приветственный оффер — скидка на ПЕРВУЮ оплату, действует ограниченное время после подтверждения
// email (см. GET /offers/welcome в server.js и payments.js → initiatePayment). Настройки — в
// public.app_settings, ключ 'welcome_offer' ({ enabled, percent, hours }); пока админ ничего не
// сохранял, действует дефолт ниже. Отсчёт идёт от email_confirmed_at, а не от created_at: аккаунт
// до подтверждения почты нерабочий, и таймер не должен тикать, пока человек даже не вошёл.
import { pool } from "./db.js";

export const DEFAULT_WELCOME_OFFER = { enabled: true, percent: 30, hours: 72 };

function sanitize(v) {
  const percent = Number(v?.percent);
  const hours = Number(v?.hours);
  return {
    enabled: v?.enabled !== false,
    percent: Number.isInteger(percent) && percent >= 1 && percent <= 90 ? percent : DEFAULT_WELCOME_OFFER.percent,
    hours: Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30 ? hours : DEFAULT_WELCOME_OFFER.hours,
  };
}

export async function resolveWelcomeOfferConfig() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'welcome_offer'");
    if (rows[0]?.value) return sanitize(rows[0].value);
  } catch (e) {
    console.warn("не удалось прочитать welcome_offer из app_settings, использую дефолт:", e?.message ?? e);
  }
  return DEFAULT_WELCOME_OFFER;
}

/** { active:false } или { active:true, percent, expiresAt (ISO) }. Оффер только для тех, кто ещё
 *  ни разу не платил и не админ; тариф на момент проверки роли не играет — оплатившему уже
 *  выставлен succeeded-платёж. */
export async function getWelcomeOffer(userId) {
  const cfg = await resolveWelcomeOfferConfig();
  if (!cfg.enabled) return { active: false };
  const { rows } = await pool.query(
    `select u.email_confirmed_at, p.is_admin,
            exists(select 1 from public.payments pay where pay.user_id = u.id and pay.status = 'succeeded') as has_paid,
            (select min(d.finished_at) from public.diagnostics d where d.user_id = u.id) as first_diagnostic_at
     from auth.users u join public.profiles p on p.id = u.id where u.id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r || r.is_admin || r.has_paid || !r.email_confirmed_at) return { active: false };
  // Окно отсчитывалось только от подтверждения почты — но пейволл (экран «План подготовки») человек
  // видит не сразу, а после онбординга и диагностики, на что на практике уходит от нескольких часов
  // до нескольких суток (живые данные 26.09.2026: часть пользователей добиралась до диагностики уже
  // с считаными часами до истечения скидки, часть — когда она уже истекла). Если диагностика пройдена
  // ПОЗЖЕ подтверждения почты, окно начинается заново от неё — тогда у человека, который только что
  // впервые увидел пейволл, полные cfg.hours на руках, а не огрызок или уже истёкшее окно.
  const basis = r.first_diagnostic_at && new Date(r.first_diagnostic_at) > new Date(r.email_confirmed_at) ? r.first_diagnostic_at : r.email_confirmed_at;
  const expires = new Date(basis).getTime() + cfg.hours * 3600 * 1000;
  if (expires <= Date.now()) return { active: false };
  return { active: true, percent: cfg.percent, expiresAt: new Date(expires).toISOString() };
}
