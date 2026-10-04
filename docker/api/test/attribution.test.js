// Атрибуция регистраций (docker/api/attribution.js): очистка присланных меток, сохранение и отчёт «источник → воронка → оплаты».
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTouch, sanitizeAttribution, saveSignupAttribution, getAttributionReport, channelOf } from "../attribution.js";
import { createTestUser, deleteTestUser, createTestPayment, pool } from "./helpers.js";

after(() => pool.end());

// createTestUser даёт адрес на .local — он в отчёт нарочно не попадает; делаем «обычный» адрес
async function realUser(opts = {}, domain = "attrtest.example.org") {
  const id = await createTestUser(opts);
  await pool.query("update auth.users set email = $2 where id = $1", [id, `at-${id}@${domain}`]);
  return id;
}

test("sanitizeTouch: только известные поля, обрезка, без управляющих символов; пустое → null", () => {
  assert.deepEqual(sanitizeTouch({ utm_source: " yandex ", utm_campaign: "k3", evil: "x", gclid: 5 }), { utm_source: "yandex", utm_campaign: "k3" });
  assert.equal(sanitizeTouch({ utm_source: "a" + String.fromCharCode(7, 0) + "b" }).utm_source, "ab");
  assert.equal(sanitizeTouch({ referrer: "a".repeat(300) }).referrer.length, 120);
  assert.equal(sanitizeTouch({}), null);
  assert.equal(sanitizeTouch("строка"), null);
  assert.equal(sanitizeTouch(null), null);
});

test("sanitizeAttribution: last по умолчанию = first; пустое → null", () => {
  assert.deepEqual(sanitizeAttribution({ first: { utm_source: "yandex" } }), { first: { utm_source: "yandex" }, last: { utm_source: "yandex" } });
  assert.deepEqual(sanitizeAttribution({ last: { yclid: "1" } }), { first: { yclid: "1" }, last: { yclid: "1" } });
  assert.equal(sanitizeAttribution({ first: {}, last: {} }), null);
  assert.equal(sanitizeAttribution(undefined), null);
});

test("channelOf: последний размеченный заход важнее первого; yclid без utm → yandex; реферер; прямой", () => {
  const A = (first, last) => ({ first_touch: first, last_touch: last });
  assert.equal(channelOf(null).channel, "нет данных (до внедрения)");
  assert.deepEqual(channelOf(A({ landing: "/" }, { utm_source: "Yandex", utm_campaign: "k3" })), { channel: "yandex", campaign: "k3" });
  assert.equal(channelOf(A({ yclid: "1" }, { yclid: "1" })).channel, "yandex (yclid)");
  assert.equal(channelOf(A({ referrer: "vk.com" }, { referrer: "vk.com" })).channel, "ref: vk.com");
  assert.equal(channelOf(A({ landing: "/" }, { landing: "/" })).channel, "прямой заход");
});

test("saveSignupAttribution: сохраняет очищенное; повторная запись не затирает; пустое не пишется", async () => {
  const id = await realUser();
  try {
    assert.equal(await saveSignupAttribution(id, undefined), false);
    assert.equal(await saveSignupAttribution(id, { first: { utm_source: "yandex", utm_campaign: "k3", landing: "/" }, last: { utm_source: "yandex", utm_campaign: "k3" } }), true);
    await saveSignupAttribution(id, { first: { utm_source: "vk" } });
    const { rows } = await pool.query("select first_touch, last_touch from public.signup_attribution where user_id = $1", [id]);
    assert.equal(rows[0].first_touch.utm_source, "yandex", "повторная запись не затирает");
    assert.equal(rows[0].last_touch.utm_campaign, "k3");
  } finally {
    await deleteTestUser(id);
  }
});

test("отчёт: считает регистрации/подтверждения/онбординг/диагностику/оплаты по каналу и кампании; без меток — в «нет данных»; тесты и админы не считаются", async () => {
  const campaign = `rep${Date.now().toString(36)}`;
  const a1 = await realUser({ onboarded: true }); // yandex/k: подтверждён + онбординг + диагностика + оплата
  const a2 = await realUser(); // yandex/k: подтверждён, дальше ничего
  const a3 = await realUser(); // yandex/k: не подтверждён
  const b1 = await realUser(); // vk
  const noData = await realUser();
  const admin = await realUser({ isAdmin: true });
  const local = await createTestUser(); // .local
  try {
    for (const id of [a1, a2, b1, noData]) await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [id]);
    await pool.query("update auth.users set email_confirmed_at = null where id = $1", [a3]);
    await saveSignupAttribution(a1, { first: { utm_source: "yandex", utm_campaign: campaign }, last: { utm_source: "yandex", utm_campaign: campaign } });
    for (const id of [a2, a3]) await saveSignupAttribution(id, { first: { utm_source: "yandex", utm_campaign: campaign } });
    await saveSignupAttribution(b1, { first: { utm_source: "vk", utm_campaign: campaign } });
    await saveSignupAttribution(admin, { first: { utm_source: "yandex", utm_campaign: campaign } });
    await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [a1]);
    const pid = await createTestPayment(a1, { status: "succeeded", amountRub: 1990 });
    assert.ok(pid);

    const r = await getAttributionReport({});
    const yk = r.rows.find((x) => x.channel === "yandex" && x.campaign === campaign);
    assert.deepEqual([yk.regs, yk.confirmed, yk.onboarded, yk.diagnostic, yk.active, yk.paid, yk.revenue], [3, 2, 1, 1, 1, 1, 1990]);
    const vk = r.rows.find((x) => x.channel === "vk" && x.campaign === campaign);
    assert.deepEqual([vk.regs, vk.confirmed, vk.paid], [1, 1, 0]);
    const nd = r.rows.find((x) => x.channel === "нет данных (до внедрения)");
    assert.ok(nd.regs >= 1);
    assert.ok(!r.rows.some((x) => x.regs === 0));
    assert.equal(r.total.regs, r.rows.reduce((s, x) => s + x.regs, 0));
    assert.ok(r.domains.every((d) => d.regs >= 3));

    // период: будущие даты → пусто; сегодняшний день → видно
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await getAttributionReport({ from: "2999-01-01" })).total.regs, 0);
    assert.ok((await getAttributionReport({ from: today, to: today })).rows.some((x) => x.campaign === campaign));
  } finally {
    for (const id of [a1, a2, a3, b1, noData, admin, local]) await deleteTestUser(id);
  }
});

test("отчёт: последний размеченный заход определяет канал (первый — прямой, затем реклама)", async () => {
  const campaign = `last${Date.now().toString(36)}`;
  const id = await realUser();
  try {
    await saveSignupAttribution(id, { first: { landing: "/" }, last: { utm_source: "yandex", utm_campaign: campaign } });
    const r = await getAttributionReport({});
    assert.ok(r.rows.some((x) => x.channel === "yandex" && x.campaign === campaign && x.regs === 1));
  } finally {
    await deleteTestUser(id);
  }
});
