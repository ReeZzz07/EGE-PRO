// Тесты серверной логики разовой оплаты тарифа (docker/api/payments.js) — гоняются против
// настоящего локального Postgres (см. helpers.js), не мока. Сам вызов ЮKassa (yookassa.js) здесь
// не тестируется — applySucceededPayment работает только с БД (public.payments/public.profiles),
// её можно проверить напрямую, без реального HTTP к ЮKassa. Запуск: `npm test` из docker/api.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { applySucceededPayment, effectiveDiscountPercent, getPaymentSummary, priceWithDiscount } from "../payments.js";
import { createTestUser, deleteTestUser, createTestPayment, pool } from "./helpers.js";

after(() => pool.end());

test("priceWithDiscount: без скидки — цена не меняется", () => {
  assert.equal(priceWithDiscount(1990, null), 1990);
  assert.equal(priceWithDiscount(1990, 0), 1990);
});

test("priceWithDiscount: округляет до копеек, не плавает на нечётных процентах", () => {
  assert.equal(priceWithDiscount(1990, 33), 1333.3);
  assert.equal(priceWithDiscount(100, 10), 90);
});

test("effectiveDiscountPercent: оффер и персональная скидка не суммируются — берётся большая; нет ни одной — null", () => {
  assert.equal(effectiveDiscountPercent(null, { active: false }), null);
  assert.equal(effectiveDiscountPercent(0, undefined), null);
  assert.equal(effectiveDiscountPercent(null, { active: true, percent: 30 }), 30);
  assert.equal(effectiveDiscountPercent(50, { active: true, percent: 30 }), 50);
  assert.equal(effectiveDiscountPercent(10, { active: true, percent: 30 }), 30);
  assert.equal(effectiveDiscountPercent(15, { active: false, percent: 30 }), 15);
});

async function getProfileTariff(userId) {
  const { rows } = await pool.query("select tariff_id, tariff_expires_at, tariff_activated_at from public.profiles where id = $1", [userId]);
  return rows[0];
}

test("applySucceededPayment: free → платный, срок считается от текущего момента", async () => {
  const userId = await createTestUser(); // free
  try {
    const paymentId = await createTestPayment(userId, { tariffId: "attestat", periodDays: 30 });
    await applySucceededPayment(paymentId);

    const profile = await getProfileTariff(userId);
    assert.equal(profile.tariff_id, "attestat");
    assert.ok(profile.tariff_activated_at);
    const daysLeft = (new Date(profile.tariff_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    assert.ok(daysLeft > 29 && daysLeft <= 30, `ожидали ~30 дней, получили ${daysLeft}`);

    const { rows } = await pool.query("select status from public.payments where id = $1", [paymentId]);
    assert.equal(rows[0].status, "succeeded");
  } finally {
    await deleteTestUser(userId);
  }
});

test("applySucceededPayment: тот же тариф ещё активен — период прибавляется к остатку, не считается с нуля", async () => {
  const userId = await createTestUser({ tariffId: "attestat" });
  try {
    const inTenDays = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await pool.query("update public.profiles set tariff_expires_at = $2 where id = $1", [userId, inTenDays.toISOString()]);

    const paymentId = await createTestPayment(userId, { tariffId: "attestat", periodDays: 30 });
    await applySucceededPayment(paymentId);

    const profile = await getProfileTariff(userId);
    const daysLeft = (new Date(profile.tariff_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    // 10 (остаток) + 30 (новый период) = ~40, а не ~30 — иначе оплата "съедала" бы неистраченные дни
    assert.ok(daysLeft > 38 && daysLeft <= 40, `ожидали ~40 дней (10 остатка + 30 нового периода), получили ${daysLeft}`);
  } finally {
    await deleteTestUser(userId);
  }
});

test("applySucceededPayment: тариф уже истёк — период считается заново от текущего момента, а не от старой даты", async () => {
  const userId = await createTestUser({ tariffId: "attestat" });
  try {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    await pool.query("update public.profiles set tariff_expires_at = $2 where id = $1", [userId, yesterday.toISOString()]);

    const paymentId = await createTestPayment(userId, { tariffId: "attestat", periodDays: 30 });
    await applySucceededPayment(paymentId);

    const profile = await getProfileTariff(userId);
    const daysLeft = (new Date(profile.tariff_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    assert.ok(daysLeft > 29 && daysLeft <= 30, `истёкший тариф не должен продлевать от старой даты, получили ${daysLeft}`);
  } finally {
    await deleteTestUser(userId);
  }
});

test("applySucceededPayment: смена тарифа — период считается от текущего момента, не от остатка старого", async () => {
  const userId = await createTestUser({ tariffId: "vuz" });
  try {
    const inTenDays = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await pool.query("update public.profiles set tariff_expires_at = $2 where id = $1", [userId, inTenDays.toISOString()]);

    const paymentId = await createTestPayment(userId, { tariffId: "attestat", periodDays: 30 });
    await applySucceededPayment(paymentId);

    const profile = await getProfileTariff(userId);
    assert.equal(profile.tariff_id, "attestat");
    const daysLeft = (new Date(profile.tariff_expires_at).getTime() - Date.now()) / (24 * 3600 * 1000);
    assert.ok(daysLeft > 29 && daysLeft <= 30, `смена тарифа не должна наследовать остаток предыдущего, получили ${daysLeft}`);
  } finally {
    await deleteTestUser(userId);
  }
});

test("applySucceededPayment: идемпотентна — повторный вызов на уже succeeded не продлевает тариф ещё раз", async () => {
  const userId = await createTestUser();
  try {
    const paymentId = await createTestPayment(userId, { tariffId: "attestat", periodDays: 30 });
    await applySucceededPayment(paymentId);
    const first = await getProfileTariff(userId);

    await applySucceededPayment(paymentId);
    const second = await getProfileTariff(userId);

    assert.equal(second.tariff_expires_at.getTime(), first.tariff_expires_at.getTime());
    assert.equal(second.tariff_activated_at.getTime(), first.tariff_activated_at.getTime());
  } finally {
    await deleteTestUser(userId);
  }
});

test("applySucceededPayment: платёж на несуществующий id — не падает, ничего не делает", async () => {
  await assert.doesNotReject(() => applySucceededPayment("00000000-0000-0000-0000-000000000000"));
});

test("getPaymentSummary: возвращает сумму числом и тариф платежа — для выручки в цели Метрики «purchase»", async () => {
  const userId = await createTestUser();
  try {
    const paymentId = await createTestPayment(userId, { tariffId: "attestat", amountRub: 1990 });
    assert.deepEqual(await getPaymentSummary(paymentId), { amountRub: 1990, tariffId: "attestat", kind: "tariff", extraSubjects: 0 });
  } finally {
    await deleteTestUser(userId);
  }
});

test("getPaymentSummary: несуществующий платёж — null", async () => {
  assert.equal(await getPaymentSummary("00000000-0000-0000-0000-000000000000"), null);
});
