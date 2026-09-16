// Бизнес-логика разовой оплаты тарифа — вынесена из server.js по тому же принципу, что
// tariffGate.js/adminUsers.js: чистые функции над pool, без Express-обвязки. См. миграцию
// 0024_payments.sql и docker/api/yookassa.js (сам HTTP-клиент ЮKassa).
import { pool } from "./db.js";
import { createYookassaPayment, fetchYookassaPayment, resolveYookassaSettings } from "./yookassa.js";
import { sendPaymentReceiptEmail } from "./mailer.js";

const PERIOD_DAYS = 30;

/** Округление до копеек математически честно — toFixed(2) на "сыром" float иногда даёт
 *  0.1+0.2-style артефакты на нечётных процентах скидки (напр. 33%). Экспортируется отдельно
 *  ради юнит-теста (см. test/payments.test.js) — сама по себе чистая функция, без БД. */
export function priceWithDiscount(priceRub, discountPercent) {
  if (!discountPercent) return priceRub;
  return Math.round(priceRub * (1 - discountPercent / 100) * 100) / 100;
}

/** Создаёт запись платежа и сам платёж в ЮKassa, возвращает ссылку для редиректа на подтверждение
 *  (3-D Secure/банк). siteUrl — реальный https-домен (CORS_ORIGIN), нужен для return_url: куда
 *  ЮKassa вернёт браузер пользователя после оплаты. */
export async function initiatePayment(userId, tariffId, siteUrl) {
  const settings = await resolveYookassaSettings();
  if (!settings) return { error: "Приём оплаты пока не настроен — обратись к администратору." };

  const { rows } = await pool.query(
    `select t.price_rub, t.sale_price_rub, t.name, p.discount_percent, u.email
     from public.tariffs t, public.profiles p, auth.users u
     where t.id = $1 and p.id = $2 and u.id = $2 and t.is_active`,
    [tariffId, userId]
  );
  const row = rows[0];
  if (!row) return { error: "Тариф не найден" };
  if (row.price_rub <= 0) return { error: "У этого тарифа нет платной версии" };

  // Персональная скидка считается от уже сниженной (sale_price_rub) цены, если она задана — иначе
  // сумма к оплате разошлась бы с тем, что видит пользователь на странице тарифов (там
  // sale_price_rub показывается как основная цена, см. Tariffs.tsx).
  const basePrice = row.sale_price_rub ?? row.price_rub;
  const amountRub = priceWithDiscount(basePrice, row.discount_percent);

  const inserted = await pool.query(
    `insert into public.payments (user_id, tariff_id, amount_rub, discount_percent, period_days, status)
     values ($1, $2, $3, $4, $5, 'pending') returning id`,
    [userId, tariffId, amountRub, row.discount_percent ?? null, PERIOD_DAYS]
  );
  const paymentId = inserted.rows[0].id;

  let ykPayment;
  try {
    ykPayment = await createYookassaPayment(settings, {
      amountRub,
      description: `ЕГЭ·ПРО — тариф «${row.name}» на ${PERIOD_DAYS} дней`,
      returnUrl: `${siteUrl}/payment/return?paymentId=${paymentId}`,
      metadata: { paymentId },
      customerEmail: row.email,
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

    const prof = await client.query("select tariff_id, tariff_expires_at from public.profiles where id = $1", [payment.user_id]);
    const p = prof.rows[0];
    const now = Date.now();
    const sameTariffStillActive = p && p.tariff_id === payment.tariff_id && p.tariff_expires_at && new Date(p.tariff_expires_at).getTime() > now;
    const base = sameTariffStillActive ? new Date(p.tariff_expires_at).getTime() : now;
    const newExpiry = new Date(base + payment.period_days * 24 * 3600 * 1000);

    await client.query("update public.profiles set tariff_id = $2, tariff_activated_at = now(), tariff_expires_at = $3 where id = $1", [
      payment.user_id,
      payment.tariff_id,
      newExpiry.toISOString(),
    ]);
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
