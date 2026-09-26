// Отбор адресатов «жизненных» писем (docker/api/lifecycle.js) против настоящего Postgres. Сама
// отправка (SMTP) здесь не проверяется — только кто попадает в выборку и что повторно не попадёт.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { findActivationCandidates, findAbandonedPaymentCandidates, findExpiryCandidates } from "../lifecycle.js";
import { createTestUser, deleteTestUser, createTestPayment, pool } from "./helpers.js";

after(() => pool.end());

// createTestUser даёт адрес @…-test.local, а .local в выборку намеренно не попадает (тестовые
// аккаунты) — для проверки самой выборки переименовываем в обычный домен.
async function makeRealisticUser(opts = {}, confirmedHoursAgo = 30) {
  const id = await createTestUser(opts);
  await pool.query("update auth.users set email = $2, email_confirmed_at = now() - make_interval(hours => $3) where id = $1", [id, `lc-${randomUUID()}@example.org`, confirmedHoursAgo]);
  return id;
}

const ids = async (fn) => (await fn(1000)).map((r) => r.id);

test("активация: подтвердил 30 часов назад, ничего не делал — в выборке", async () => {
  const id = await makeRealisticUser();
  try {
    assert.ok((await ids(findActivationCandidates)).includes(id));
  } finally {
    await deleteTestUser(id);
  }
});

test("активация: слишком свежий (5 ч), слишком старый (6 дней), платный, админ — не в выборке", async () => {
  const fresh = await makeRealisticUser({}, 5);
  const old = await makeRealisticUser({}, 24 * 6);
  const paid = await makeRealisticUser({ tariffId: "attestat" });
  const admin = await makeRealisticUser({ isAdmin: true });
  try {
    const got = await ids(findActivationCandidates);
    for (const id of [fresh, old, paid, admin]) assert.ok(!got.includes(id));
  } finally {
    for (const id of [fresh, old, paid, admin]) await deleteTestUser(id);
  }
});

test("активация: уже решал задания / делал диагностику / получал письмо — не в выборке", async () => {
  const solved = await makeRealisticUser();
  const diag = await makeRealisticUser();
  const mailed = await makeRealisticUser();
  try {
    await pool.query("insert into public.attempts (user_id, task_id, given, correct, seconds) values ($1, 'x-1', '1', true, 5)", [solved]);
    await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [diag]);
    await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, 'activation_d1')", [mailed]);
    const got = await ids(findActivationCandidates);
    assert.ok(!got.includes(solved));
    assert.ok(!got.includes(diag));
    assert.ok(!got.includes(mailed));
  } finally {
    for (const id of [solved, diag, mailed]) await deleteTestUser(id);
  }
});

test("брошенная оплата: pending 2 часа назад — в выборке; свежий (10 мин) и оплативший — нет; письмо один раз", async () => {
  const abandoned = await makeRealisticUser();
  const freshPay = await makeRealisticUser();
  const paidLater = await makeRealisticUser();
  try {
    const p1 = await createTestPayment(abandoned, { status: "pending" });
    await pool.query("update public.payments set created_at = now() - interval '2 hours' where id = $1", [p1]);
    await createTestPayment(freshPay, { status: "pending" });
    const p2 = await createTestPayment(paidLater, { status: "canceled" });
    await pool.query("update public.payments set created_at = now() - interval '2 hours' where id = $1", [p2]);
    const p3 = await createTestPayment(paidLater, { status: "succeeded" });
    assert.ok(p3);

    let got = await ids(findAbandonedPaymentCandidates);
    assert.ok(got.includes(abandoned));
    assert.ok(!got.includes(freshPay));
    assert.ok(!got.includes(paidLater));

    await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, 'payment_abandoned')", [abandoned]);
    got = await ids(findAbandonedPaymentCandidates);
    assert.ok(!got.includes(abandoned));
  } finally {
    for (const id of [abandoned, freshPay, paidLater]) await deleteTestUser(id);
  }
});

// Регрессия: раньше запрос требовал p.tariff_id = 'free' для ЛЮБОГО вида платежа — уже оплативший тариф
// человек, бросивший докупку предметов или продление, никогда не попадал в выборку (найдено на реальных
// данных прода 26.09.2026: платёж kind=addon от уже оплатившего пользователя завис в pending и письмо
// не ушло). Условие теперь требует free-тариф только для kind='tariff' (первая покупка).
test("брошенная оплата: докупка предметов/продление у УЖЕ оплатившего тариф — в выборке; бросил вторую покупку тарифа — нет", async () => {
  const abandonedAddon = await makeRealisticUser({ tariffId: "attestat" });
  const abandonedRenewal = await makeRealisticUser({ tariffId: "attestat" });
  const abandonedSecondTariff = await makeRealisticUser({ tariffId: "attestat" });
  try {
    for (const [id, kind] of [
      [abandonedAddon, "addon"],
      [abandonedRenewal, "renewal"],
      [abandonedSecondTariff, "tariff"],
    ]) {
      // все трое уже когда-то успешно купили тариф (kind='tariff') — иначе их tariff_id не был бы 'attestat'
      await pool.query("insert into public.payments (user_id, tariff_id, amount_rub, period_days, status, kind) values ($1,'attestat',1990,30,'succeeded','tariff')", [id]);
      const p = await createTestPayment(id, { status: "pending", kind });
      await pool.query("update public.payments set created_at = now() - interval '2 hours' where id = $1", [p]);
    }
    const got = await ids(findAbandonedPaymentCandidates);
    assert.ok(got.includes(abandonedAddon), "докупка предметов должна попадать в выборку даже с платным тарифом");
    assert.ok(got.includes(abandonedRenewal), "продление должно попадать в выборку даже с платным тарифом");
    assert.ok(!got.includes(abandonedSecondTariff), "повторная покупка ТАРИФА уже оплатившим — не повод для этого письма");
  } finally {
    for (const id of [abandonedAddon, abandonedRenewal, abandonedSecondTariff]) await deleteTestUser(id);
  }
});

test("брошенная оплата: kind попадает в результат — нужен для правильной кнопки в письме (addon → /subjects, renewal → /renew)", async () => {
  const id = await makeRealisticUser();
  try {
    const p = await createTestPayment(id, { status: "pending", kind: "addon" });
    await pool.query("update public.payments set created_at = now() - interval '2 hours' where id = $1", [p]);
    const rows = await findAbandonedPaymentCandidates(1000);
    assert.equal(rows.find((r) => r.id === id)?.kind, "addon");
  } finally {
    await deleteTestUser(id);
  }
});

test("срок тарифа: за 3 дня до окончания — «скоро», после окончания — «закончился»; один раз на период; free/админ не получают", async () => {
  const soon = await makeRealisticUser({ tariffId: "vuz", tariffExpiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString() });
  const far = await makeRealisticUser({ tariffId: "vuz", tariffExpiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString() });
  const gone = await makeRealisticUser({ tariffId: "vuz", tariffExpiresAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString() });
  const longGone = await makeRealisticUser({ tariffId: "vuz", tariffExpiresAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() });
  const free = await makeRealisticUser();
  const admin = await makeRealisticUser({ isAdmin: true, tariffId: "vuz", tariffExpiresAt: new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString() });
  try {
    const expiring = (await findExpiryCandidates(false, 1000)).map((r) => r.id);
    const expired = (await findExpiryCandidates(true, 1000)).map((r) => r.id);
    assert.ok(expiring.includes(soon));
    for (const id of [far, gone, longGone, free, admin]) assert.ok(!expiring.includes(id));
    assert.ok(expired.includes(gone));
    for (const id of [soon, far, longGone, free, admin]) assert.ok(!expired.includes(id));

    // после записи в журнал — больше не выбирается; новый оплаченный период (другая дата) — снова да
    const row = (await findExpiryCandidates(false, 1000)).find((r) => r.id === soon);
    assert.match(row.kind, /^expiring:\d{4}-\d{2}-\d{2}$/);
    await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, $2)", [soon, row.kind]);
    assert.ok(!(await findExpiryCandidates(false, 1000)).map((r) => r.id).includes(soon));
    await pool.query("update public.profiles set tariff_expires_at = now() + interval '1 day' where id = $1", [soon]);
    assert.ok((await findExpiryCandidates(false, 1000)).map((r) => r.id).includes(soon));
  } finally {
    for (const id of [soon, far, gone, longGone, free, admin]) await deleteTestUser(id);
  }
});
