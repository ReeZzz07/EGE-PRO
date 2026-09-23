// Бизнес-логика разовой оплаты тарифа — вынесена из server.js по тому же принципу, что
// tariffGate.js/adminUsers.js: чистые функции над pool, без Express-обвязки. См. миграцию
// 0024_payments.sql и docker/api/yookassa.js (сам HTTP-клиент ЮKassa).
import { pool } from "./db.js";
import { createYookassaPayment, fetchYookassaPayment, resolveYookassaSettings } from "./yookassa.js";
import { sendPaymentReceiptEmail } from "./mailer.js";
import { getWelcomeOffer } from "./offers.js";
import { effectiveDiscountPercent, priceWithDiscount } from "./pricing.js";
import { getSubscription, addonAmount, resolveAddonConfig } from "./subscription.js";

const PERIOD_DAYS = 30;

export { priceWithDiscount, effectiveDiscountPercent } from "./pricing.js";

/** Создаёт запись платежа и сам платёж в ЮKassa, возвращает ссылку для редиректа на подтверждение
 *  (3-D Secure/банк). Общая часть для всех видов оплаты (tariff / renewal / addon) — сумму, вид и
 *  описание считает вызывающий код. siteUrl — реальный https-домен (CORS_ORIGIN), нужен для
 *  return_url: куда ЮKassa вернёт браузер пользователя после оплаты. */
async function startPayment({ userId, tariffId, amountRub, discountPercent, periodDays, kind, extraSubjects = 0, description, siteUrl }) {
  const settings = await resolveYookassaSettings();
  if (!settings) return { error: "Приём оплаты пока не настроен — обратись к администратору." };

  const email = (await pool.query("select email from auth.users where id = $1", [userId])).rows[0]?.email;

  const inserted = await pool.query(
    `insert into public.payments (user_id, tariff_id, amount_rub, discount_percent, period_days, status, kind, extra_subjects)
     values ($1, $2, $3, $4, $5, 'pending', $6, $7) returning id`,
    [userId, tariffId, amountRub, discountPercent ?? null, periodDays, kind, extraSubjects]
  );
  const paymentId = inserted.rows[0].id;

  let ykPayment;
  try {
    ykPayment = await createYookassaPayment(settings, {
      amountRub,
      description,
      returnUrl: `${siteUrl}/payment/return?paymentId=${paymentId}`,
      metadata: { paymentId },
      customerEmail: email,
      // Свой же id строки — готовый уникальный ключ, отдельный randomUUID() не нужен: повторный
      // POST /payments/create с тем же paymentId (ретрай на сетевой сбой) не создаст в ЮKassa
      // второй платёж на ту же попытку и не спишет деньги дважды.
      idempotenceKey: paymentId,
    });
  } catch (e) {
    await pool.query("delete from public.payments where id = $1", [paymentId]);
    return { error: `Не удалось создать платёж: ${e?.message ?? e}` };
  }

  await pool.query("update public.payments set provider_payment_id = $2 where id = $1", [paymentId, ykPayment.id]);
  return { paymentId, confirmationUrl: ykPayment.confirmationUrl };
}

/** Обычная покупка тарифа со страницы тарифов. */
export async function initiatePayment(userId, tariffId, siteUrl) {
  const { rows } = await pool.query(
    `select t.price_rub, t.sale_price_rub, t.name, p.discount_percent
     from public.tariffs t, public.profiles p
     where t.id = $1 and p.id = $2 and t.is_active`,
    [tariffId, userId]
  );
  const row = rows[0];
  if (!row) return { error: "Тариф не найден" };
  if (row.price_rub <= 0) return { error: "У этого тарифа нет платной версии" };

  // Персональная скидка считается от уже сниженной (sale_price_rub) цены, если она задана — иначе
  // сумма к оплате разошлась бы с тем, что видит пользователь на странице тарифов (там
  // sale_price_rub показывается как основная цена, см. Tariffs.tsx).
  const basePrice = row.sale_price_rub ?? row.price_rub;
  // Приветственный оффер (см. offers.js) и персональная скидка админа не суммируются — берётся
  // большая: иначе скидки перемножались бы и цена уезжала ниже того, что обещано на странице.
  const offer = await getWelcomeOffer(userId);
  const discountPercent = effectiveDiscountPercent(row.discount_percent, offer);
  return startPayment({
    userId,
    tariffId,
    amountRub: priceWithDiscount(basePrice, discountPercent),
    discountPercent,
    periodDays: PERIOD_DAYS,
    kind: "tariff",
    description: `ЕГЭ·ПРО — тариф «${row.name}» на ${PERIOD_DAYS} дней`,
    siteUrl,
  });
}

/** Продление «как было»: тот же тариф и те же докупленные предметы, что были у пользователя (см.
 *  subscription.js → renewal). Тариф и состав берутся из профиля на сервере, а не из запроса, —
 *  клиент не может подсунуть чужой тариф или цену. Работает и для действующего тарифа (продление
 *  заранее прибавляет 30 дней к остатку), и для истёкшего. */
export async function initiateRenewal(userId, siteUrl) {
  const sub = await getSubscription(userId);
  if (!sub?.renewal) return { error: "Нечего продлять — у тебя нет платного тарифа или он больше не продаётся. Выбери тариф на странице «Тарифы»." };
  const r = sub.renewal;
  const extras = r.extraSubjects > 0 ? ` + докупленных предметов: ${r.extraSubjects}` : "";
  return startPayment({
    userId,
    tariffId: r.tariffId,
    amountRub: r.amountRub,
    discountPercent: r.discountPercent,
    periodDays: r.periodDays,
    kind: "renewal",
    extraSubjects: r.extraSubjects,
    description: `ЕГЭ·ПРО — продление тарифа «${r.tariffName}»${extras} на ${r.periodDays} дней`,
    siteUrl,
  });
}

/** Докупка предметов к ДЕЙСТВУЮЩЕМУ тарифу на оставшийся срок (срок тарифа не меняется). */
export async function initiateAddon(userId, count, siteUrl) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return { error: "Укажи, сколько предметов докупить" };
  const sub = await getSubscription(userId);
  if (!sub?.addon) return { error: "Докупить предметы можно только к действующему платному тарифу." };
  if (n > sub.addon.maxCount) return { error: `Сейчас можно докупить не больше ${sub.addon.maxCount} предм.` };
  const amountRub = sub.addon.quotes[n - 1];
  return startPayment({
    userId,
    tariffId: sub.tariffId,
    amountRub,
    discountPercent: sub.addon.discountPercent,
    periodDays: sub.addon.remainingDays,
    kind: "addon",
    extraSubjects: n,
    description: `ЕГЭ·ПРО — докупка предметов (${n}) к тарифу «${sub.tariffName}» на ${sub.addon.remainingDays} дн.`,
    siteUrl,
  });
}

/** Применяет успешный платёж — продлевает тариф пользователя. Идемпотентно (проверка статуса под
 * FOR UPDATE): и вебхук, и статус-поллинг с фронтенда (см. getPaymentStatus ниже) могут вызвать её
 * для одного и того же платежа, продлить тариф должно ровно один раз. Тот же тариф, ещё не
 * истёкший, — прибавляем период к ОСТАВШЕМУСЯ сроку (честное продление), а не считаем с нуля от
 * now(); смена тарифа или истёкший срок — считаем с нуля. */
export async function applySucceededPayment(paymentId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const cur = await client.query("select * from public.payments where id = $1 for update", [paymentId]);
    const payment = cur.rows[0];
    if (!payment || payment.status === "succeeded") {
      await client.query("commit");
      return;
    }
    await client.query("update public.payments set status = 'succeeded' where id = $1", [paymentId]);

    const prof = await client.query("select tariff_id, tariff_expires_at, extra_subjects from public.profiles where id = $1", [payment.user_id]);
    const p = prof.rows[0];
    const now = Date.now();
    const sameTariffStillActive = !!(p && p.tariff_id === payment.tariff_id && p.tariff_expires_at && new Date(p.tariff_expires_at).getTime() > now);
    let newExpiry;

    if (payment.kind === "addon") {
      // докупка предметов: срок тарифа не двигается, только растёт число доступных предметов
      newExpiry = p?.tariff_expires_at ? new Date(p.tariff_expires_at) : new Date(now);
      await client.query("update public.profiles set extra_subjects = least(20, extra_subjects + $2) where id = $1", [payment.user_id, payment.extra_subjects]);
    } else {
      const base = sameTariffStillActive ? new Date(p.tariff_expires_at).getTime() : now;
      newExpiry = new Date(base + payment.period_days * 24 * 3600 * 1000);
      // renewal возвращает прежний состав (extra_subjects записан в платёж при создании); обычная
      // покупка тарифа сохраняет докупленные предметы только при продлении ТОГО ЖЕ ещё действующего
      // тарифа — смена тарифа или покупка после окончания срока начинает с чистого состава.
      const extras = payment.kind === "renewal" ? payment.extra_subjects : sameTariffStillActive ? p.extra_subjects : 0;
      await client.query("update public.profiles set tariff_id = $2, tariff_activated_at = now(), tariff_expires_at = $3, extra_subjects = $4 where id = $1", [
        payment.user_id,
        payment.tariff_id,
        newExpiry.toISOString(),
        extras,
      ]);
    }
    await client.query("commit");

    // Чек — вне транзакции и best-effort: тариф уже применён, письмо не должно ни задерживать,
    // ни (тем более) откатывать уже совершённое продление, если почта временно недоступна.
    const receipt = await pool.query(
      `select u.email, t.name as tariff_name from auth.users u, public.tariffs t where u.id = $1 and t.id = $2`,
      [payment.user_id, payment.tariff_id]
    );
    if (receipt.rows[0]) {
      sendPaymentReceiptEmail(receipt.rows[0].email, {
        tariffName: receipt.rows[0].tariff_name,
        amountRub: payment.amount_rub,
        periodDays: payment.period_days,
        expiresAt: newExpiry.toISOString(),
        kind: payment.kind,
        extraSubjects: payment.extra_subjects,
      }).catch((e) => console.warn("не удалось отправить чек об оплате:", e?.message ?? e));
    }
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Вебхук ЮKassa шлёт { event, object: { id, status, metadata } } — но доверять этому телу
 * напрямую нельзя (ЮKassa не подписывает уведомления общим секретом, который можно было бы здесь
 * проверить, а сам URL эндпоинта публичный): реальный статус всегда переспрашивается у ЮKassa
 * авторизованным запросом (fetchYookassaPayment), тело вебхука используется только как триггер
 * "сходи проверь платёж с таким id", а не как источник истины. */
export async function handleYookassaWebhook(providerPaymentId) {
  const settings = await resolveYookassaSettings();
  if (!settings) return;
  const real = await fetchYookassaPayment(settings, providerPaymentId);
  const paymentId = real.metadata?.paymentId;
  if (!paymentId) return;
  if (real.status === "succeeded") {
    await applySucceededPayment(paymentId);
  } else if (real.status === "canceled") {
    await pool.query("update public.payments set status = 'canceled' where id = $1 and status = 'pending'", [paymentId]);
  }
}

/** Статус для фронтенда (страница возврата после оплаты, см. PaymentReturnView.tsx). Если всё ещё
 * pending — сами переспрашиваем ЮKassa здесь же, не полагаясь только на вебхук: тот мог задержаться,
 * не дойти вовсе (сетевой сбой, вебхук в личном кабинете ЮKassa ещё не настроен на момент запуска)
 * или прийти раньше, чем пользователь успел вернуться с банковской страницы. */
export async function getPaymentStatus(paymentId, userId, isAdmin) {
  const { rows } = await pool.query("select id, user_id, status, provider_payment_id from public.payments where id = $1", [paymentId]);
  const row = rows[0];
  if (!row) return null;
  if (row.user_id !== userId && !isAdmin) return null;

  if (row.status === "pending" && row.provider_payment_id) {
    const settings = await resolveYookassaSettings();
    if (settings) {
      try {
        const real = await fetchYookassaPayment(settings, row.provider_payment_id);
        if (real.status === "succeeded") await applySucceededPayment(paymentId);
        else if (real.status === "canceled") await pool.query("update public.payments set status = 'canceled' where id = $1 and status = 'pending'", [paymentId]);
      } catch (e) {
        console.warn("не удалось переспросить статус платежа у ЮKassa:", e?.message ?? e);
      }
    }
  }

  const fresh = await pool.query("select status from public.payments where id = $1", [paymentId]);
  return fresh.rows[0]?.status ?? row.status;
}

/** Сумма и тариф проведённого платежа — фронтенд передаёт их в цель Метрики «purchase» (выручка и
 *  электронная коммерция, см. src/lib/metrika.ts). Права на платёж уже проверены getPaymentStatus,
 *  сюда вызывается только после него. null — платежа нет. */
export async function getPaymentSummary(paymentId) {
  const { rows } = await pool.query("select amount_rub, tariff_id, kind, extra_subjects from public.payments where id = $1", [paymentId]);
  if (!rows[0]) return null;
  return { amountRub: Number(rows[0].amount_rub), tariffId: rows[0].tariff_id, kind: rows[0].kind, extraSubjects: rows[0].extra_subjects };
}
