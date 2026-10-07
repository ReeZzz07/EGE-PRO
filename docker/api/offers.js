// Приветственный оффер — скидка на ПЕРВУЮ оплату, складывается из трёх частей за шаги пользователя:
//   • confirm    — подтвердил почту (email_confirmed_at);
//   • onboarding — прошёл онбординг (profiles.onboarded_at);
//   • diagnostic — прошёл диагностику (первая запись в diagnostics).
// Размер каждой части и общий срок — в public.app_settings, ключ 'welcome_offer'
// ({ enabled, hours, confirmPercent, onboardingPercent, diagnosticPercent }); пока админ ничего не
// сохранял, действует дефолт ниже. Старый формат { enabled, percent, hours } читается как раньше:
// percent делится на три части поровну (см. sanitize). См. GET /offers/welcome в server.js и
// payments.js → initiatePayment.
//
// Срок: cfg.hours отсчитываются от САМОГО ПОЗДНЕГО из уже сделанных шагов — каждый новый шаг
// увеличивает скидку и заново открывает полное окно. Аккаунт до подтверждения почты нерабочий, поэтому
// без неё оффера нет вовсе (и таймер не тикает, пока человек даже не вошёл).
import { pool } from "./db.js";

export const DEFAULT_WELCOME_OFFER = { enabled: true, hours: 120, confirmPercent: 10, onboardingPercent: 10, diagnosticPercent: 10 };

export const OFFER_STEPS = [
  { key: "confirm", field: "confirmPercent" },
  { key: "onboarding", field: "onboardingPercent" },
  { key: "diagnostic", field: "diagnosticPercent" },
];
/** Потолок суммарной скидки — тот же, что был у единого percent (1–90 %). */
export const MAX_TOTAL_PERCENT = 90;

const partOf = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_TOTAL_PERCENT ? v : null);

function sanitize(v) {
  const hours = Number(v?.hours);
  let parts = OFFER_STEPS.map((s) => partOf(Number(v?.[s.field])));
  if (parts.some((p) => p === null)) {
    // старый формат: единый percent делим на три части (остаток — к диагностике)
    const legacy = Number(v?.percent);
    if (Number.isInteger(legacy) && legacy >= 1 && legacy <= MAX_TOTAL_PERCENT) {
      const third = Math.floor(legacy / 3);
      parts = [third, third, legacy - 2 * third];
    } else {
      parts = OFFER_STEPS.map((s) => DEFAULT_WELCOME_OFFER[s.field]);
    }
  }
  const total = parts.reduce((a, b) => a + b, 0);
  if (total < 1 || total > MAX_TOTAL_PERCENT) parts = OFFER_STEPS.map((s) => DEFAULT_WELCOME_OFFER[s.field]);
  const out = {
    enabled: v?.enabled !== false,
    hours: Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30 ? hours : DEFAULT_WELCOME_OFFER.hours,
  };
  OFFER_STEPS.forEach((s, i) => {
    out[s.field] = parts[i];
  });
  return out;
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

/** { active:false } или
 *  { active:true, percent (уже заработано), maxPercent (сумма всех частей), expiresAt (ISO),
 *    steps: [{ key, percent, earned }] }.
 *  Оффер только для тех, кто ещё ни разу не платил и не админ; тариф на момент проверки роли не
 *  играет — оплатившему уже выставлен succeeded-платёж. */
async function computeWelcomeOffer(userId) {
  const cfg = await resolveWelcomeOfferConfig();
  if (!cfg.enabled) return { active: false };
  const { rows } = await pool.query(
    `select u.email_confirmed_at, p.is_admin, p.onboarded_at,
            exists(select 1 from public.payments pay where pay.user_id = u.id and pay.status = 'succeeded') as has_paid,
            (select min(d.finished_at) from public.diagnostics d where d.user_id = u.id) as first_diagnostic_at
     from auth.users u join public.profiles p on p.id = u.id where u.id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r || r.is_admin || r.has_paid || !r.email_confirmed_at) return { active: false };

  const doneAt = { confirm: r.email_confirmed_at, onboarding: r.onboarded_at, diagnostic: r.first_diagnostic_at };
  const steps = OFFER_STEPS.map((s) => ({ key: s.key, percent: cfg[s.field], earned: !!doneAt[s.key] }));
  const percent = steps.filter((s) => s.earned).reduce((a, s) => a + s.percent, 0);
  if (percent < 1) return { active: false };

  // Диагностика могла быть пройдена гостем ДО подтверждения почты — окно всё равно от самого позднего
  // шага, а не «назад в прошлое». Живые данные 26.09.2026: до диагностики люди добирались от нескольких
  // часов до нескольких суток после подтверждения, так что окно от одного лишь подтверждения часто
  // истекало раньше, чем человек впервые видел пейволл.
  const basis = Math.max(...steps.filter((s) => s.earned).map((s) => new Date(doneAt[s.key]).getTime()));
  const expires = basis + cfg.hours * 3600 * 1000;
  if (expires <= Date.now()) return { active: false };
  return {
    active: true,
    percent,
    maxPercent: steps.reduce((a, s) => a + s.percent, 0),
    expiresAt: new Date(expires).toISOString(),
    steps,
  };
}

// ─────────── дополнительная скидка из рассылки ───────────
// Рассылка может подарить тем, у кого приветственная скидка уже закончилась, новую скидку на первую оплату на
// ограниченный срок (campaigns.js, миграция 0043). Для остального приложения она неотличима от оффера:
// getWelcomeOffer ниже отдаёт её в том же виде (без шагов), и цена при оплате, плашки и письма работают как есть.
const ELIGIBLE_SQL = `not p.is_admin and u.email_confirmed_at is not null
  and not exists (select 1 from public.payments pay where pay.user_id = u.id and pay.status = 'succeeded')`;

/** Действующая дополнительная скидка пользователя (для ещё не платившего подтвердившего почту) или null. */
async function activeBonus(userId) {
  const { rows } = await pool.query(
    `select b.percent, b.expires_at from public.user_bonus_discounts b
       join auth.users u on u.id = b.user_id join public.profiles p on p.id = u.id
      where b.user_id = $1 and b.expires_at > now() and ${ELIGIBLE_SQL}
      order by b.percent desc, b.expires_at desc limit 1`,
    [userId]
  );
  return rows[0] ? { percent: rows[0].percent, expiresAt: new Date(rows[0].expires_at).toISOString() } : null;
}

/** Выдаёт скидку percent % на hours часов от сейчас. Только тому, кто подходит под оффер (подтвердил почту,
 *  не админ, ещё не платил); одна выдача на пару «рассылка + пользователь». true — выдана. */
export async function grantBonusDiscount(userId, campaignId, percent, hours) {
  const { rows } = await pool.query(
    `insert into public.user_bonus_discounts (user_id, percent, expires_at, campaign_id)
     select u.id, $2, now() + make_interval(hours => $3), $4 from auth.users u join public.profiles p on p.id = u.id
      where u.id = $1 and ${ELIGIBLE_SQL}
     on conflict (campaign_id, user_id) where campaign_id is not null do nothing
     returning id`,
    [userId, percent, hours, campaignId]
  );
  return rows.length > 0;
}

/** Оффер пользователя: приветственный (за шаги) и/или подаренный рассылкой — действует больший процент.
 *  Подаренный отдаётся без шагов ({ steps: [], bonus: true }), maxPercent = percent. */
export async function getWelcomeOffer(userId) {
  const welcome = await computeWelcomeOffer(userId);
  const bonus = await activeBonus(userId);
  if (bonus && (!welcome.active || bonus.percent > welcome.percent)) {
    return { active: true, percent: bonus.percent, maxPercent: bonus.percent, expiresAt: bonus.expiresAt, steps: [], bonus: true };
  }
  return welcome;
}

