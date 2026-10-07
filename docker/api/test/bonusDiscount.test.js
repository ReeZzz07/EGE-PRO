// Дополнительная скидка из рассылки (миграция 0043): тем, у кого приветственная скидка закончилась, письмо дарит новую
// на ограниченный срок; у кого скидка действует — в письме их обычная. Против настоящего локального Postgres;
// отправка писем подменяется, до SMTP дело не доходит.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCampaign, getCampaign, normalizeBonus, previewRecipients, renderCampaignSample, resolveCampaignOffer, validateCampaignContent } from "../campaigns.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

const tag = `bonus${randomUUID().slice(0, 8)}`;
const users = [];
const campaigns = [];

after(async () => {
  for (const id of campaigns) await pool.query("delete from public.email_campaigns where id = $1", [id]);
  for (const id of users) await deleteTestUser(id);
  await pool.end();
});

const content = (extra = {}) => ({ subject: `Тема ${tag}`, bodyText: "Привет, {имя}! Проверка.", eyebrow: "скидка", ctaLabel: "Открыть →", ctaPath: "/tariffs", footer: "Разовое письмо.", ...extra });

async function user(name, { hoursAgo = 400, paid = false, unconfirmed = false, q = tag } = {}) {
  const id = await createTestUser();
  users.push(id);
  await pool.query("update auth.users set email = $2, email_confirmed_at = $3 where id = $1", [id, `${q}-${name}@example.org`, unconfirmed ? null : new Date(Date.now() - hoursAgo * 3600 * 1000)]);
  await pool.query("update public.profiles set full_name = $2 where id = $1", [id, `Бонус ${name}`]);
  if (paid) await pool.query("insert into public.payments (user_id, tariff_id, amount_rub, period_days, status, kind) values ($1, 'attestat', 1990, 30, 'succeeded', 'tariff')", [id]);
  return id;
}
const bonusRows = async (userId) => (await pool.query("select percent, campaign_id from public.user_bonus_discounts where user_id = $1", [userId])).rows;
async function campaignRow(over = {}) {
  const { rows } = await pool.query(
    "insert into public.email_campaigns (kind, subject, body_text, include_offer, bonus_percent, bonus_hours, total) values ('custom', $1, 'текст', $2, $3, $4, 1) returning *",
    [`BON ${tag} ${Math.random()}`, over.include ?? true, over.percent ?? null, over.hours ?? null]
  );
  campaigns.push(rows[0].id);
  return rows[0];
}
async function waitDone(id) {
  for (let i = 0; i < 100; i++) {
    const c = await getCampaign(id);
    if (c.status !== "sending") return c;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("рассылка не завершилась");
}

test("поля подарка: проценты 1–50, часы 1–336 (по умолчанию 72); 0 или пусто — не дарить; без блока скидки в письме нельзя", () => {
  assert.deepEqual(normalizeBonus({}), { percent: null, hours: 72 });
  assert.deepEqual(normalizeBonus({ bonusPercent: 0 }), { percent: null, hours: 72 });
  assert.deepEqual(normalizeBonus({ bonusPercent: 15 }), { percent: 15, hours: 72 });
  assert.deepEqual(normalizeBonus({ bonusPercent: "20", bonusHours: "48" }), { percent: 20, hours: 48 });
  for (const bad of [{ bonusPercent: 51 }, { bonusPercent: -5 }, { bonusPercent: 10.5 }, { bonusPercent: 10, bonusHours: 0 }, { bonusPercent: 10, bonusHours: 337 }]) {
    assert.ok(normalizeBonus(bad).error, JSON.stringify(bad));
  }
  assert.match(validateCampaignContent("custom", content({ bonusPercent: 10, includeOffer: false })), /только вместе с блоком скидки/);
  assert.equal(validateCampaignContent("custom", content({ bonusPercent: 10, includeOffer: true })), null);
  assert.match(validateCampaignContent("custom", content({ bonusPercent: 99, includeOffer: true })), /от 1 до 50/);
});

test("resolveCampaignOffer: у кого скидка действует — своя, подарок не выдаётся; у кого закончилась — выдаётся и видна как обычная; не подходящим — нет", async () => {
  const active = await user("active", { hoursAgo: 2 });
  const expired = await user("expired");
  const paid = await user("paid", { paid: true });
  const unconfirmed = await user("unconf", { unconfirmed: true });
  const campaign = await campaignRow({ percent: 15, hours: 48 });

  const a = await resolveCampaignOffer(campaign, { id: active });
  assert.equal(a.active, true);
  assert.equal(a.percent, 10, "приветственная, не подарок");
  assert.equal(a.bonus, undefined);
  assert.equal((await bonusRows(active)).length, 0, "кому скидка ещё действует, подарок не начисляется");

  const e = await resolveCampaignOffer(campaign, { id: expired });
  assert.equal(e.active, true);
  assert.equal(e.percent, 15);
  assert.equal(e.bonus, true);
  const hours = (new Date(e.expiresAt).getTime() - Date.now()) / 3600000;
  assert.ok(hours > 47.9 && hours <= 48, `ожидали ~48 часов, получили ${hours}`);
  const given = await bonusRows(expired);
  assert.equal(given.length, 1);
  assert.equal(given[0].campaign_id, campaign.id);
  // повторный вызов той же рассылки не выдаёт второй раз
  assert.equal((await resolveCampaignOffer(campaign, { id: expired })).percent, 15);
  assert.equal((await bonusRows(expired)).length, 1);

  assert.equal((await resolveCampaignOffer(campaign, { id: paid })).active, false);
  assert.equal((await resolveCampaignOffer(campaign, { id: unconfirmed })).active, false);
  assert.equal((await bonusRows(paid)).length + (await bonusRows(unconfirmed)).length, 0);
});

test("рассылка без подарка не выдаёт его; без блока скидки — null и ничего не выдаёт", async () => {
  const expired = await user("expired2");
  const noBonus = await campaignRow({ include: true });
  assert.equal((await resolveCampaignOffer(noBonus, { id: expired })).active, false);
  const noOffer = await campaignRow({ include: false, percent: 20, hours: 24 });
  assert.equal(await resolveCampaignOffer(noOffer, { id: expired }), null);
  assert.equal((await bonusRows(expired)).length, 0);
});

test("создание рассылки: процент и срок подарка сохраняются, сам подарок выдаётся позже, при отправке; без блока скидки или с кривым процентом — отказ", async () => {
  const q = `${tag}-create`;
  const u = await user("c1", { q });
  const base = { adminId: null, kind: "custom", ...content({ subject: `CR ${tag}` }), includeOffer: true, filters: {}, q, excludeRecent: false, confirmCount: 1 };
  const opts = { send: async () => {}, delayMs: 0 };
  const a = await createCampaign({ ...base, bonusPercent: 25, bonusHours: 36 }, opts);
  campaigns.push(a.id);
  await waitDone(a.id);
  const row = await getCampaign(a.id);
  assert.equal(row.bonus_percent, 25);
  assert.equal(row.bonus_hours, 36);
  assert.equal((await bonusRows(u)).length, 0, "подарок выдаётся в момент отправки письма, не при создании");

  const plain = await createCampaign({ ...base, subject: `CR2 ${tag}` }, opts);
  campaigns.push(plain.id);
  await waitDone(plain.id);
  assert.equal((await getCampaign(plain.id)).bonus_percent, null);

  await assert.rejects(createCampaign({ ...base, subject: `CR3 ${tag}`, includeOffer: false, bonusPercent: 10 }, opts), (e) => e.code === "INVALID");
  await assert.rejects(createCampaign({ ...base, subject: `CR4 ${tag}`, bonusPercent: 70 }, opts), (e) => e.code === "INVALID");
});

test("предпросмотр получателей: expiredOffer — сколько из них без действующей скидки (им достанется подарок)", async () => {
  const q = `${tag}-pv`;
  await user("a1", { hoursAgo: 3, q });
  await user("a2", { hoursAgo: 5, q });
  await user("e1", { hoursAgo: 500, q });
  await user("e2", { hoursAgo: 600, q });
  await user("e3", { hoursAgo: 700, q });
  const p = await previewRecipients({ q, filters: {}, kind: "custom", excludeRecent: false });
  assert.equal(p.count, 5);
  assert.equal(p.expiredOffer, 3);
  const onlyActive = await previewRecipients({ q, filters: { offer_active: "yes" }, kind: "custom", excludeRecent: false });
  assert.equal(onlyActive.count, 2);
  assert.equal(onlyActive.expiredOffer, 0);
});

test("фильтр «скидка ещё активна» считает и подаренную скидку", async () => {
  const q = `${tag}-flt`;
  const gifted = await user("gifted", { hoursAgo: 900, q });
  await user("plain", { hoursAgo: 900, q });
  const campaign = await campaignRow({ percent: 10, hours: 24 });
  await resolveCampaignOffer(campaign, { id: gifted });
  const yes = await previewRecipients({ q, filters: { offer_active: "yes" }, kind: "custom", excludeRecent: false });
  assert.equal(yes.count, 1);
  assert.match(yes.sample[0].email, /gifted/);
});

test("предпросмотр письма с подарком показывает скидку из полей рассылки, а не образцовую приветственную", () => {
  const withBonus = renderCampaignSample("custom", content({ includeOffer: true, bonusPercent: 15, bonusHours: 48 }));
  assert.ok(withBonus.html.includes("−15%"));
  assert.ok(!withBonus.html.includes("до −30%"), "без подсказок про рост за шаги");
  const plain = renderCampaignSample("custom", content({ includeOffer: true }));
  assert.ok(plain.html.includes("до −30%"), "без подарка — образец приветственной скидки, как раньше");
  assert.ok(!renderCampaignSample("custom", content()).html.includes("−"), "без блока скидки — ничего");
});
