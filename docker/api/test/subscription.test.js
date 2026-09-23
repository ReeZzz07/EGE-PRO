// Подписка: срок тарифа, докупка предметов, «заморозка» предметов после окончания, продление
// «как было» (docker/api/subscription.js, payments.js, триггер enforce_subject_limit из миграции
// 0029) — против настоящего локального Postgres.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { addonAmount, getSubscription, remainingDaysUntil, splitSubjects } from "../subscription.js";
import { applySucceededPayment } from "../payments.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

after(() => pool.end());

const DAY = 24 * 3600 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

async function subjectsOf(id) {
  return (await pool.query("select subject from public.profile_subjects where user_id = $1 order by added_at, subject", [id])).rows.map((r) => r.subject);
}

/** vuz (4 предмета), действует ещё days дней; подключаем предметы до 4 штук (2 уже даёт триггер регистрации) */
async function vuzUser({ days = 20, extra = 0, subjects = 4 } = {}) {
  const id = await createTestUser({ tariffId: "vuz", tariffExpiresAt: days >= 0 ? inDays(days) : inDays(days) });
  await pool.query("update public.profiles set extra_subjects = $2 where id = $1", [id, extra]);
  const have = await subjectsOf(id);
  for (const s of ["fiz", "chem", "hist", "soc", "bio", "geo", "lit"]) {
    if (have.length >= subjects) break;
    if (!have.includes(s)) {
      await pool.query("insert into public.profile_subjects (user_id, subject) values ($1, $2)", [id, s]);
      have.push(s);
    }
  }
  return id;
}

test("addonAmount: пропорционально оставшимся дням, округление вверх, скидка, минимум 1 ₽", () => {
  assert.equal(addonAmount(1290, 1, 30, null), 1290);
  assert.equal(addonAmount(1290, 1, 15, null), 645);
  assert.equal(addonAmount(1290, 2, 10, null), 860);
  assert.equal(addonAmount(1290, 1, 7, null), 301); // 301.0 → ровно
  assert.equal(addonAmount(1000, 1, 15, 10), 450);
  assert.equal(addonAmount(1, 1, 1, null), 1);
});

test("splitSubjects: первые по порядку подключения остаются доступными, остальные замораживаются", () => {
  assert.deepEqual(splitSubjects(["a", "b", "c", "d"], 2), { active: ["a", "b"], frozen: ["c", "d"] });
  assert.deepEqual(splitSubjects(["a", "b"], 5), { active: ["a", "b"], frozen: [] });
  assert.deepEqual(splitSubjects(["a", "b"], null), { active: ["a", "b"], frozen: [] });
});

test("remainingDaysUntil: округляет вверх, в прошлом — 0", () => {
  assert.equal(remainingDaysUntil(inDays(1.2)), 2);
  assert.equal(remainingDaysUntil(inDays(-3)), 0);
});

test("подписка: бесплатный тариф — лимит free, нечего продлять и докупать", async () => {
  const id = await createTestUser();
  try {
    const s = await getSubscription(id);
    assert.equal(s.paid, false);
    assert.equal(s.active, false);
    assert.equal(s.expired, false);
    assert.equal(s.renewal, null);
    assert.equal(s.addon, null);
    assert.equal(s.frozenSubjects.length, 0);
  } finally {
    await deleteTestUser(id);
  }
});

test("подписка: действующий ВУЗ — лимит 4 (+докупка), предложение докупить, продление с текущим составом", async () => {
  const id = await vuzUser({ days: 20, extra: 1, subjects: 4 });
  try {
    const s = await getSubscription(id);
    assert.equal(s.active, true);
    assert.equal(s.expired, false);
    assert.equal(s.subjectsCap, 5);
    assert.equal(s.frozenSubjects.length, 0);
    assert.equal(s.daysLeft, 20);
    assert.equal(s.renewal.tariffId, "vuz");
    assert.equal(s.renewal.extraSubjects, 1);
    assert.ok(s.addon);
    assert.equal(s.addon.remainingDays, 20);
    assert.equal(s.addon.quotes.length, s.addon.maxCount);
    assert.equal(s.addon.quotes[0], addonAmount(s.addon.unitPriceRub, 1, 20, s.addon.discountPercent));
  } finally {
    await deleteTestUser(id);
  }
});

test("подписка: срок закончился — данные на месте, лишние предметы заморожены, предлагается продлить с прежним составом", async () => {
  const id = await vuzUser({ days: 20, extra: 1, subjects: 5 });
  try {
    await pool.query("update public.profiles set tariff_expires_at = now() - interval '2 days' where id = $1", [id]);
    const before = await subjectsOf(id);
    const s = await getSubscription(id);
    assert.equal(s.active, false);
    assert.equal(s.expired, true);
    assert.equal(s.subjectsCap, 2); // лимит бесплатного тарифа
    assert.deepEqual(s.activeSubjects, before.slice(0, 2));
    assert.deepEqual(s.frozenSubjects, before.slice(2));
    assert.equal(s.frozenSubjects.length, 3);
    assert.equal(s.addon, null, "докупать к истёкшему тарифу нельзя — только продлить");
    assert.equal(s.renewal.tariffId, "vuz");
    assert.equal(s.renewal.extraSubjects, 1, "докупка запомнена как часть прежних настроек");
    assert.deepEqual(await subjectsOf(id), before, "подключённые предметы не удалены");
  } finally {
    await deleteTestUser(id);
  }
});

test("триггер: истёкший тариф — нельзя подключить предмет сверх лимита free; действующий + докупка — можно", async () => {
  const id = await vuzUser({ days: 20, extra: 0, subjects: 4 });
  try {
    await assert.rejects(pool.query("insert into public.profile_subjects (user_id, subject) values ($1, 'lit')", [id]), /лимит предметов/);
    await pool.query("update public.profiles set extra_subjects = 1 where id = $1", [id]);
    await pool.query("insert into public.profile_subjects (user_id, subject) values ($1, 'lit')", [id]);
    await pool.query("update public.profiles set tariff_expires_at = now() - interval '1 day' where id = $1", [id]);
    await assert.rejects(pool.query("insert into public.profile_subjects (user_id, subject) values ($1, 'geo')", [id]), /лимит предметов/);
  } finally {
    await deleteTestUser(id);
  }
});

async function makePayment(userId, { kind, tariffId = "vuz", extra = 0, periodDays = 30 }) {
  const { rows } = await pool.query(
    `insert into public.payments (user_id, tariff_id, amount_rub, period_days, status, kind, extra_subjects) values ($1,$2,100,$3,'pending',$4,$5) returning id`,
    [userId, tariffId, periodDays, kind, extra]
  );
  return rows[0].id;
}
const profileOf = async (id) => (await pool.query("select tariff_id, tariff_expires_at, extra_subjects from public.profiles where id = $1", [id])).rows[0];

test("оплата докупки: extra_subjects растёт, срок тарифа не двигается", async () => {
  const id = await vuzUser({ days: 20, extra: 1, subjects: 4 });
  try {
    const before = await profileOf(id);
    await applySucceededPayment(await makePayment(id, { kind: "addon", extra: 2, periodDays: 20 }));
    const after = await profileOf(id);
    assert.equal(after.extra_subjects, 3);
    assert.equal(new Date(after.tariff_expires_at).getTime(), new Date(before.tariff_expires_at).getTime());
    // повторная обработка того же платежа (вебхук + поллинг) не удваивает докупку
    const pid = await makePayment(id, { kind: "addon", extra: 1, periodDays: 20 });
    await applySucceededPayment(pid);
    await applySucceededPayment(pid);
    assert.equal((await profileOf(id)).extra_subjects, 4);
  } finally {
    await deleteTestUser(id);
  }
});

test("оплата продления после окончания срока: тариф и докупленные предметы возвращаются, замороженные снова доступны", async () => {
  const id = await vuzUser({ days: 20, extra: 1, subjects: 5 });
  try {
    await pool.query("update public.profiles set tariff_expires_at = now() - interval '5 days' where id = $1", [id]);
    assert.equal((await getSubscription(id)).frozenSubjects.length, 3);

    await applySucceededPayment(await makePayment(id, { kind: "renewal", extra: 1 }));
    const p = await profileOf(id);
    assert.equal(p.tariff_id, "vuz");
    assert.equal(p.extra_subjects, 1);
    const days = (new Date(p.tariff_expires_at).getTime() - Date.now()) / DAY;
    assert.ok(days > 29 && days <= 30, `срок ${days}`);

    const s = await getSubscription(id);
    assert.equal(s.active, true);
    assert.equal(s.frozenSubjects.length, 0);
    assert.equal(s.activeSubjects.length, 5);
  } finally {
    await deleteTestUser(id);
  }
});

test("оплата продления заранее: 30 дней прибавляются к остатку; обычная покупка того же тарифа сохраняет докупку, другого — сбрасывает", async () => {
  const id = await vuzUser({ days: 10, extra: 2, subjects: 4 });
  try {
    await applySucceededPayment(await makePayment(id, { kind: "renewal", extra: 2 }));
    let p = await profileOf(id);
    const days = (new Date(p.tariff_expires_at).getTime() - Date.now()) / DAY;
    assert.ok(days > 39 && days <= 40, `срок ${days}`);
    assert.equal(p.extra_subjects, 2);

    await applySucceededPayment(await makePayment(id, { kind: "tariff", tariffId: "vuz" }));
    assert.equal((await profileOf(id)).extra_subjects, 2, "тот же действующий тариф — докупка сохраняется");

    await applySucceededPayment(await makePayment(id, { kind: "tariff", tariffId: "attestat" }));
    p = await profileOf(id);
    assert.equal(p.tariff_id, "attestat");
    assert.equal(p.extra_subjects, 0, "смена тарифа — чистый состав");
  } finally {
    await deleteTestUser(id);
  }
});
