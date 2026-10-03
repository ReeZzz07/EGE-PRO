// Приветственный оффер (docker/api/offers.js) — против настоящего локального Postgres.
// Скидка = три части (подтверждение почты / онбординг / диагностика), срок — от самого позднего шага.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getWelcomeOffer, resolveWelcomeOfferConfig } from "../offers.js";
import { createTestUser, deleteTestUser, createTestPayment, pool } from "./helpers.js";

after(async () => {
  await pool.query("delete from public.app_settings where key = 'welcome_offer'");
  await pool.end();
});

async function setConfirmedAgo(userId, hours) {
  await pool.query("update auth.users set email_confirmed_at = now() - make_interval(hours => $2) where id = $1", [userId, hours]);
}

async function setOnboardedAgo(userId, hours) {
  await pool.query("update public.profiles set onboarded_at = now() - make_interval(hours => $2) where id = $1", [userId, hours]);
}

// Пункт из разбора воронки 26.09.2026: между подтверждением почты и первой диагностикой у реальных
// пользователей проходит от нескольких часов до нескольких суток — окно от одного лишь подтверждения
// часто истекало ещё до того, как человек впервые видел пейволл. Поэтому срок считается от самого
// позднего пройденного шага.
async function insertDiagnostic(userId, hoursAgo, subject = "math") {
  await pool.query("insert into public.diagnostics (user_id, subject, finished_at) values ($1, $2, now() - make_interval(hours => $3))", [userId, subject, hoursAgo]);
}

const hoursLeft = (o) => (new Date(o.expiresAt).getTime() - Date.now()) / 3600000;
const clearCfg = () => pool.query("delete from public.app_settings where key = 'welcome_offer'");

test("конфиг: дефолт — 10+10+10 % на 120 часов", async () => {
  await clearCfg();
  const cfg = await resolveWelcomeOfferConfig();
  assert.deepEqual(cfg, { enabled: true, hours: 120, confirmPercent: 10, onboardingPercent: 10, diagnosticPercent: 10 });
});

test("оффер: только подтвердил почту — активна первая часть (10%), видно, что ещё 20% можно заработать", async () => {
  await clearCfg();
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 2);
    const o = await getWelcomeOffer(id);
    assert.equal(o.active, true);
    assert.equal(o.percent, 10);
    assert.equal(o.maxPercent, 30);
    assert.deepEqual(o.steps.map((s) => [s.key, s.percent, s.earned]), [["confirm", 10, true], ["onboarding", 10, false], ["diagnostic", 10, false]]);
    assert.ok(hoursLeft(o) > 117.9 && hoursLeft(o) <= 118.01, `осталось ${hoursLeft(o)}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: онбординг добавляет вторую часть (20%) и заново открывает полное окно от онбординга", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 70);
    await setOnboardedAgo(id, 10);
    const o = await getWelcomeOffer(id);
    assert.equal(o.percent, 20);
    assert.ok(hoursLeft(o) > 109 && hoursLeft(o) < 111, `ожидали ~110ч (120-10), получили ${hoursLeft(o)}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: подтвердил, прошёл онбординг и диагностику — все 30%, окно от диагностики", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 20);
    await setOnboardedAgo(id, 3);
    await insertDiagnostic(id, 1);
    const o = await getWelcomeOffer(id);
    assert.equal(o.active, true);
    assert.equal(o.percent, 30);
    assert.equal(o.maxPercent, 30);
    assert.ok(o.steps.every((s) => s.earned));
    assert.ok(hoursLeft(o) > 118.9 && hoursLeft(o) <= 119.01, `осталось ${hoursLeft(o)}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: почта не подтверждена — не активен, даже если остальные шаги есть", async () => {
  const id = await createTestUser({ onboarded: true });
  try {
    await pool.query("update auth.users set email_confirmed_at = null where id = $1", [id]);
    await insertDiagnostic(id, 1);
    assert.equal((await getWelcomeOffer(id)).active, false);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: окно закончилось (с последнего шага больше 120ч) — не активен", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 200);
    await setOnboardedAgo(id, 130);
    await insertDiagnostic(id, 121);
    assert.equal((await getWelcomeOffer(id)).active, false);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: старое окно закрылось, но новый шаг открывает его заново — вернулся и прошёл диагностику", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 300);
    await setOnboardedAgo(id, 290);
    assert.equal((await getWelcomeOffer(id)).active, false, "окно от онбординга (290ч назад) давно закрыто");
    await insertDiagnostic(id, 2);
    const o = await getWelcomeOffer(id);
    assert.equal(o.active, true);
    assert.equal(o.percent, 30);
    assert.ok(hoursLeft(o) > 117.9 && hoursLeft(o) <= 118.01);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: уже была успешная оплата или админ — не активен", async () => {
  const paid = await createTestUser({ onboarded: true });
  const admin = await createTestUser({ isAdmin: true, onboarded: true });
  try {
    await setConfirmedAgo(paid, 1);
    await insertDiagnostic(paid, 1);
    await setConfirmedAgo(admin, 1);
    await insertDiagnostic(admin, 1);
    const pid = await createTestPayment(paid, { status: "succeeded" });
    assert.ok(pid);
    assert.equal((await getWelcomeOffer(paid)).active, false);
    assert.equal((await getWelcomeOffer(admin)).active, false);
  } finally {
    await deleteTestUser(paid);
    await deleteTestUser(admin);
  }
});

test("оффер: брошенный (pending) платёж оффер не гасит", async () => {
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 1);
    await insertDiagnostic(id, 1);
    await createTestPayment(id, { status: "pending" });
    assert.equal((await getWelcomeOffer(id)).active, true);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: настройки из app_settings (части/часы/выключатель) применяются, мусор — дефолт", async () => {
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 1);
    await insertDiagnostic(id, 1);
    await pool.query("insert into public.app_settings (key, value) values ('welcome_offer', $1) on conflict (key) do update set value = excluded.value", [
      JSON.stringify({ enabled: true, hours: 24, confirmPercent: 5, onboardingPercent: 15, diagnosticPercent: 25 }),
    ]);
    const o = await getWelcomeOffer(id);
    assert.equal(o.percent, 45);
    assert.equal(o.maxPercent, 45);
    assert.ok(hoursLeft(o) > 23.9 && hoursLeft(o) <= 24.01, `осталось ${hoursLeft(o)}`); // самый поздний шаг — онбординг «только что»

    await pool.query("update public.app_settings set value = $1 where key = 'welcome_offer'", [JSON.stringify({ enabled: false })]);
    assert.equal((await getWelcomeOffer(id)).active, false);

    await pool.query("update public.app_settings set value = $1 where key = 'welcome_offer'", [JSON.stringify({ confirmPercent: 500, hours: -3 })]);
    const cfg = await resolveWelcomeOfferConfig();
    assert.equal(cfg.confirmPercent + cfg.onboardingPercent + cfg.diagnosticPercent, 30);
    assert.equal(cfg.hours, 120);

    // суммарно больше потолка 90% — тоже дефолт
    await pool.query("update public.app_settings set value = $1 where key = 'welcome_offer'", [JSON.stringify({ confirmPercent: 40, onboardingPercent: 40, diagnosticPercent: 40 })]);
    assert.equal((await resolveWelcomeOfferConfig()).confirmPercent, 10);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: часть можно обнулить — скидка только за нужные шаги", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 1);
    await pool.query("insert into public.app_settings (key, value) values ('welcome_offer', $1) on conflict (key) do update set value = excluded.value", [
      JSON.stringify({ hours: 120, confirmPercent: 0, onboardingPercent: 10, diagnosticPercent: 20 }),
    ]);
    assert.equal((await getWelcomeOffer(id)).active, false, "за один лишь подтверждённый email 0% — оффера нет");
    await pool.query("update public.profiles set onboarded_at = now() where id = $1", [id]);
    assert.equal((await getWelcomeOffer(id)).percent, 10);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: старый формат { percent } делится на три части поровну", async () => {
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 1);
    await insertDiagnostic(id, 1);
    await pool.query("insert into public.app_settings (key, value) values ('welcome_offer', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ percent: 50, hours: 48 })]);
    const cfg = await resolveWelcomeOfferConfig();
    assert.deepEqual([cfg.confirmPercent, cfg.onboardingPercent, cfg.diagnosticPercent], [16, 16, 18]);
    assert.equal((await getWelcomeOffer(id)).percent, 50);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: диагностика была РАНЬШЕ подтверждения (гостевой прогон до входа) — окно всё равно от подтверждения, не назад в прошлое", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await insertDiagnostic(id, 100);
    await setConfirmedAgo(id, 1);
    await setOnboardedAgo(id, 1);
    const o = await getWelcomeOffer(id);
    assert.equal(o.percent, 30);
    assert.ok(hoursLeft(o) > 118.9 && hoursLeft(o) <= 119.01, `ожидали ~119ч, получили ${hoursLeft(o)}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: несколько диагностик — учитывается САМАЯ РАННЯЯ (первое реальное появление у пейволла), не последняя", async () => {
  await clearCfg();
  const id = await createTestUser({ onboarded: true });
  try {
    await setConfirmedAgo(id, 100);
    await setOnboardedAgo(id, 90);
    await insertDiagnostic(id, 50, "math");
    await insertDiagnostic(id, 5, "rus"); // повторная диагностика много позже — не должна продлевать заново
    const o = await getWelcomeOffer(id);
    assert.ok(hoursLeft(o) > 69 && hoursLeft(o) < 71, `ожидали ~70ч (120-50), получили ${hoursLeft(o)}`);
  } finally {
    await deleteTestUser(id);
  }
});
