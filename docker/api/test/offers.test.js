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
