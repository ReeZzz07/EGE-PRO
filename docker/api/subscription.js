// Состояние подписки пользователя: действует ли тариф, сколько предметов доступно (тариф + докупка),
// какие подключённые предметы «заморожены» после окончания срока, и что предложить для продления /
// докупки. Один источник правды и для интерфейса (GET /subscription), и для оплаты (payments.js) —
// сумма, которую видит ученик, и сумма, которую с него берут, считаются здесь одним кодом.
//
// Что происходит по окончании срока (tariff_expires_at в прошлом):
//  • данные ученика НЕ удаляются: прогресс, попытки, тетрадь ошибок, план, чат, подключённые предметы;
//  • тариф считается бесплатным: лимит ИИ (см. tariffGate.js), проверка сочинений, число предметов —
//    условия free; в profiles остаётся прежний tariff_id и extra_subjects — это «прежние настройки»;
//  • предметы сверх лимита бесплатного тарифа «замораживаются»: остаются в списке, но решать по ним
//    нельзя; порядок — по дате подключения, первые остаются доступными;
//  • продление (kind = 'renewal') одним платежом возвращает тариф с докупленными предметами, а вместе
//    с ним и доступ к замороженным — выбирать тариф и предметы заново не нужно.
import { pool } from "./db.js";
import { effectiveDiscountPercent, priceWithDiscount } from "./pricing.js";
import { getWelcomeOffer } from "./offers.js";

export const PERIOD_DAYS = 30;
/** Всего предметов на платформе (см. SUBJECTS в src/data/tasks.ts) — выше этого докупать нечего. */
export const TOTAL_SUBJECTS = 12;
export const MAX_ADDON_PER_PURCHASE = 5;
export const DEFAULT_ADDON_CONFIG = { enabled: true, priceRub: 1290 };

const DAY_MS = 24 * 3600 * 1000;

export async function resolveAddonConfig() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'subject_addon'");
    const v = rows[0]?.value;
    if (v) {
      const price = Number(v.priceRub);
      return {
        enabled: v.enabled !== false,
        priceRub: Number.isInteger(price) && price >= 1 && price <= 100000 ? price : DEFAULT_ADDON_CONFIG.priceRub,
      };
    }
  } catch (e) {
    console.warn("не удалось прочитать subject_addon из app_settings, использую дефолт:", e?.message ?? e);
  }
  return DEFAULT_ADDON_CONFIG;
}

/** Цена докупки count предметов на remainingDays оставшихся дней (пропорционально месяцу, округление
 *  вверх до рубля — так докупка никогда не выходит дешевле честной доли), затем скидка. Минимум 1 ₽ —
 *  у платёжного провайдера нулевых платежей не бывает. */
export function addonAmount(unitPriceRub, count, remainingDays, discountPercent) {
  const gross = Math.ceil((unitPriceRub * count * remainingDays) / PERIOD_DAYS);
  return Math.max(1, priceWithDiscount(gross, discountPercent));
}

/** Делит подключённые предметы (в порядке подключения) на доступные и замороженные по лимиту. */
export function splitSubjects(subjects, cap) {
  if (cap == null) return { active: subjects, frozen: [] };
  return { active: subjects.slice(0, cap), frozen: subjects.slice(cap) };
}

export function remainingDaysUntil(expiresAt, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS));
}

export async function getSubscription(userId) {
  const { rows } = await pool.query(
    `select p.is_admin, p.tariff_id, p.tariff_expires_at, p.extra_subjects, p.discount_percent,
            t.name as tariff_name, t.price_rub, t.sale_price_rub, t.subjects_count, t.is_active as tariff_is_active,
            (select f.subjects_count from public.tariffs f where f.id = 'free') as free_subjects
     from public.profiles p
     left join public.tariffs t on t.id = p.tariff_id
     where p.id = $1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;

  const subj = await pool.query("select subject from public.profile_subjects where user_id = $1 order by added_at, subject", [userId]);
  const subjects = subj.rows.map((x) => x.subject);

  const now = Date.now();
  const paid = r.tariff_id !== "free" && (r.price_rub ?? 0) > 0;
  const expiresMs = r.tariff_expires_at ? new Date(r.tariff_expires_at).getTime() : null;
  const active = paid && (expiresMs == null || expiresMs > now);
  const expired = paid && expiresMs != null && expiresMs <= now;

  let cap;
  if (r.is_admin) cap = null;
  else if (active) cap = r.subjects_count + r.extra_subjects;
  else cap = r.free_subjects ?? null;
  const { active: activeSubjects, frozen: frozenSubjects } = splitSubjects(subjects, cap);

  const addonCfg = await resolveAddonConfig();
  const offer = await getWelcomeOffer(userId);
  const discount = effectiveDiscountPercent(r.discount_percent, offer);

  let renewal = null;
  if (paid && !r.is_admin && r.tariff_is_active) {
    const tariffPrice = r.sale_price_rub ?? r.price_rub;
    const addonsPrice = addonCfg.enabled ? r.extra_subjects * addonCfg.priceRub : 0;
    renewal = {
      tariffId: r.tariff_id,
      tariffName: r.tariff_name,
      extraSubjects: addonCfg.enabled ? r.extra_subjects : 0,
      tariffPriceRub: tariffPrice,
      addonsPriceRub: addonsPrice,
      discountPercent: discount,
      amountRub: priceWithDiscount(tariffPrice + addonsPrice, discount),
      periodDays: PERIOD_DAYS,
    };
  }

  let addon = null;
  if (active && expiresMs != null && !r.is_admin && addonCfg.enabled) {
    const remainingDays = remainingDaysUntil(r.tariff_expires_at, now);
    const room = TOTAL_SUBJECTS - (r.subjects_count + r.extra_subjects);
    const maxCount = Math.max(0, Math.min(MAX_ADDON_PER_PURCHASE, room));
    if (remainingDays >= 1 && maxCount > 0) {
      addon = {
        unitPriceRub: addonCfg.priceRub,
        remainingDays,
        maxCount,
        discountPercent: discount,
        // цена за 1..maxCount предметов — чтобы интерфейс показывал сумму без собственных расчётов
        quotes: Array.from({ length: maxCount }, (_, i) => addonAmount(addonCfg.priceRub, i + 1, remainingDays, discount)),
      };
    }
  }

  return {
    isAdmin: r.is_admin,
    tariffId: r.tariff_id,
    tariffName: r.tariff_name ?? null,
    paid,
    expiresAt: r.tariff_expires_at ? new Date(r.tariff_expires_at).toISOString() : null,
    active,
    expired,
    daysLeft: active && expiresMs != null ? remainingDaysUntil(r.tariff_expires_at, now) : null,
    extraSubjects: r.extra_subjects,
    subjectsCap: cap,
    activeSubjects,
    frozenSubjects,
    renewal,
    addon,
  };
}
