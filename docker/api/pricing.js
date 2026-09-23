// Чистые функции расчёта цены — вынесены отдельно, чтобы payments.js и subscription.js могли
// пользоваться ими, не импортируя друг друга по кругу.

/** Округление до копеек математически честно — toFixed(2) на "сыром" float иногда даёт
 *  0.1+0.2-style артефакты на нечётных процентах скидки (напр. 33%). */
export function priceWithDiscount(priceRub, discountPercent) {
  if (!discountPercent) return priceRub;
  return Math.round(priceRub * (1 - discountPercent / 100) * 100) / 100;
}

/** Итоговый процент скидки: персональная скидка админа и приветственный оффер не суммируются —
 *  берётся большая (иначе скидки перемножались бы и цена уезжала бы ниже обещанного на странице).
 *  null — скидки нет. */
export function effectiveDiscountPercent(personalPercent, offer) {
  return Math.max(personalPercent ?? 0, offer?.active ? offer.percent : 0) || null;
}
