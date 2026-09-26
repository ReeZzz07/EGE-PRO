// Приветственный оффер (docker/api/offers.js) — против настоящего локального Postgres.
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

test("оффер: свежеподтверждённый пользователь — активен, дефолт 30% на 72 часа", async () => {
  await pool.query("delete from public.app_settings where key = 'welcome_offer'");
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 1);
    const o = await getWelcomeOffer(id);
    assert.equal(o.active, true);
    assert.equal(o.percent, 30);
    const hoursLeft = (new Date(o.expiresAt).getTime() - Date.now()) / 3600000;
    assert.ok(hoursLeft > 70.9 && hoursLeft <= 71.01, `осталось ${hoursLeft}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: окно закончилось — не активен", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 73);
    assert.equal((await getWelcomeOffer(id)).active, false);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: уже была успешная оплата или админ — не активен", async () => {
  const paid = await createTestUser();
  const admin = await createTestUser({ isAdmin: true });
  try {
    await setConfirmedAgo(paid, 1);
    await setConfirmedAgo(admin, 1);
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
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 1);
    await createTestPayment(id, { status: "pending" });
    assert.equal((await getWelcomeOffer(id)).active, true);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: настройки из app_settings (процент/часы/выключатель) применяются, мусор — дефолт", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 1);
    await pool.query("insert into public.app_settings (key, value) values ('welcome_offer', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify({ enabled: true, percent: 50, hours: 24 })]);
    const o = await getWelcomeOffer(id);
    assert.equal(o.percent, 50);
    assert.ok(new Date(o.expiresAt).getTime() - Date.now() < 23 * 3600000 + 60000);

    await pool.query("update public.app_settings set value = $1 where key = 'welcome_offer'", [JSON.stringify({ enabled: false })]);
    assert.equal((await getWelcomeOffer(id)).active, false);

    await pool.query("update public.app_settings set value = $1 where key = 'welcome_offer'", [JSON.stringify({ percent: 500, hours: -3 })]);
    const cfg = await resolveWelcomeOfferConfig();
    assert.equal(cfg.percent, 30);
    assert.equal(cfg.hours, 72);
  } finally {
    await deleteTestUser(id);
  }
});

// Пункт из разбора воронки 26.09.2026: между подтверждением почты и первой диагностикой у реальных
// пользователей проходит от нескольких часов до нескольких суток — окно в 72 часа от подтверждения
// часто истекало ещё до того, как человек впервые видел пейволл (экран «План подготовки»). Диагностика
// позже подтверждения должна давать полные cfg.hours от СЕБЯ, а не от уже почти истёкшего окна.
async function insertDiagnostic(userId, hoursAgo, subject = "math") {
  await pool.query("insert into public.diagnostics (user_id, subject, finished_at) values ($1, $2, now() - make_interval(hours => $3))", [userId, subject, hoursAgo]);
}

test("оффер: диагностика ПОЗЖЕ подтверждения — окно отсчитывается заново от неё, а не от уже почти истёкшего confirmed", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 70); // подтвердил 70ч назад — по старой логике оставалось бы ~2ч
    await insertDiagnostic(id, 10); // но диагностику прошёл только 10ч назад
    const o = await getWelcomeOffer(id);
    assert.equal(o.active, true);
    const hoursLeft = (new Date(o.expiresAt).getTime() - Date.now()) / 3600000;
    assert.ok(hoursLeft > 61 && hoursLeft < 63, `ожидали ~62ч (72-10), получили ${hoursLeft}`); // не ~2ч
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: диагностика позже подтверждения, но и с неё уже прошло больше 72ч — не активен", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 200);
    await insertDiagnostic(id, 80);
    assert.equal((await getWelcomeOffer(id)).active, false);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: диагностика была РАНЬШЕ подтверждения (гостевой прогон до входа) — окно всё равно от подтверждения, не назад в прошлое", async () => {
  const id = await createTestUser();
  try {
    await insertDiagnostic(id, 100); // диагностика раньше — не должна отодвигать окно в прошлое
    await setConfirmedAgo(id, 1);
    const o = await getWelcomeOffer(id);
    const hoursLeft = (new Date(o.expiresAt).getTime() - Date.now()) / 3600000;
    assert.ok(hoursLeft > 70.9 && hoursLeft <= 71.01, `ожидали ~71ч от подтверждения, получили ${hoursLeft}`);
  } finally {
    await deleteTestUser(id);
  }
});

test("оффер: несколько диагностик — учитывается САМАЯ РАННЯЯ (первое реальное появление у пейволла), не последняя", async () => {
  const id = await createTestUser();
  try {
    await setConfirmedAgo(id, 100);
    await insertDiagnostic(id, 50, "math");
    await insertDiagnostic(id, 5, "rus"); // повторная диагностика много позже — не должна продлевать заново
    const o = await getWelcomeOffer(id);
    const hoursLeft = (new Date(o.expiresAt).getTime() - Date.now()) / 3600000;
    assert.ok(hoursLeft > 21 && hoursLeft < 23, `ожидали ~22ч (72-50), получили ${hoursLeft}`);
  } finally {
    await deleteTestUser(id);
  }
});
