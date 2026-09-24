// Рассылки из админки (docker/api/campaigns.js) против настоящего Postgres, с подставным «отправщиком»
// вместо SMTP: отбор получателей и исключения, подтверждение числа, отправка/пропуск/ошибки, отмена,
// возобновление после перезапуска, содержимое письма.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildCampaignEmail,
  cancelCampaign,
  CampaignError,
  createCampaign,
  getCampaign,
  listCampaigns,
  previewRecipients,
  renderCampaignSample,
  resumeCampaigns,
  runCampaign,
  validateCampaignContent,
} from "../campaigns.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

const tag = `camp${randomUUID().slice(0, 8)}`;
const users = [];
const subjects = [];

async function makeUser(name, opts = {}) {
  const id = await createTestUser({ isAdmin: !!opts.admin });
  users.push(id);
  await pool.query("update auth.users set email = $2, email_confirmed_at = $3 where id = $1", [id, `${tag}-${name}@${opts.local ? "camp.local" : "example.org"}`, opts.unconfirmed ? null : new Date()]);
  await pool.query("update public.profiles set full_name = $2, onboarded_at = $3, anonymized_at = $4 where id = $1", [id, `Тест ${name} ${tag}`, opts.onboarded ? new Date() : null, opts.anonymized ? new Date() : null]);
  return id;
}

after(async () => {
  for (const s of subjects) await pool.query("delete from public.email_campaigns where subject = $1 or id::text = $1", [s]);
  for (const id of users) await deleteTestUser(id);
  await pool.end();
});

const content = (extra = {}) => ({ subject: `Тема ${tag}`, bodyText: "Привет, {имя}! Проверка.", eyebrow: "напоминание", ctaLabel: "Открыть →", ctaPath: "", footer: "Разовое письмо.", ...extra });
const waitDone = async (id) => {
  for (let i = 0; i < 100; i++) {
    const c = await getCampaign(id);
    if (c.status !== "sending") return c;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("рассылка не завершилась");
};
const fakeSender = () => {
  const sent = [];
  return { sent, send: async (_c, user) => void sent.push(user.id) };
};
const qOnly = { q: tag };

let A, B, C, ADMIN, ANON, LOCAL;
async function setup() {
  if (A) return;
  A = await makeUser("a-onb", { onboarded: true });
  B = await makeUser("b-noonb");
  C = await makeUser("c-unconf", { unconfirmed: true });
  ADMIN = await makeUser("admin", { admin: true });
  ANON = await makeUser("anon", { anonymized: true });
  LOCAL = await makeUser("local", { local: true });
}

test("получатели: админы, анонимизированные и .local не попадают никогда; фильтры и инверсия работают", async () => {
  await setup();
  const p = (filters) => previewRecipients({ ...qOnly, filters, kind: "custom" }).then((r) => r);
  assert.equal((await p({})).count, 3); // A, B, C
  assert.equal((await p({ onboarded: "no" })).count, 2); // B, C
  assert.equal((await p({ onboarded: "yes" })).count, 1); // A
  assert.equal((await p({ confirmed: "no" })).count, 1); // C
  const sample = (await p({})).sample.map((s) => s.id);
  for (const bad of [ADMIN, ANON, LOCAL]) assert.ok(!sample.includes(bad));
});

test("повторная ссылка подтверждения: только неподтверждённые, даже если фильтр требует обратного", async () => {
  await setup();
  assert.equal((await previewRecipients({ ...qOnly, filters: {}, kind: "verify_link" })).count, 1);
  assert.equal((await previewRecipients({ ...qOnly, filters: { confirmed: "no" }, kind: "verify_link" })).count, 1);
  assert.equal((await previewRecipients({ ...qOnly, filters: { confirmed: "yes" }, kind: "verify_link" })).count, 0);
});

test("создание: число получателей нужно подтвердить точно; пустая выборка и кривое содержимое отклоняются", async () => {
  await setup();
  const base = { adminId: null, kind: "custom", ...content(), filters: { onboarded: "no" }, ...qOnly };
  await assert.rejects(createCampaign({ ...base, confirmCount: 5 }), (e) => e instanceof CampaignError && e.code === "COUNT_MISMATCH" && e.extra.count === 2);
  await assert.rejects(createCampaign({ ...base, confirmCount: undefined }), (e) => e.code === "COUNT_MISMATCH");
  await assert.rejects(createCampaign({ ...base, filters: { onboarded: "yes", confirmed: "no" }, confirmCount: 0 }), (e) => e.code === "EMPTY");
  await assert.rejects(createCampaign({ ...base, subject: "", confirmCount: 2 }), (e) => e.code === "INVALID");
  await assert.rejects(createCampaign({ ...base, ctaPath: "https://evil.example", confirmCount: 2 }), (e) => e.code === "INVALID");
  assert.equal((await listCampaigns(50)).filter((c) => c.subject === `Тема ${tag}`).length, 0, "неудачные попытки ничего не создали");
});

test("отправка: каждому получателю ровно одно письмо, итоги сходятся, снимок фильтра сохранён", async () => {
  await setup();
  const f = fakeSender();
  const { id, total } = await createCampaign({ adminId: null, kind: "custom", ...content({ subject: `S1 ${tag}` }), filters: { onboarded: "no" }, ...qOnly, confirmCount: 2 }, { send: f.send, delayMs: 0 });
  subjects.push(id);
  assert.equal(total, 2);
  const c = await waitDone(id);
  assert.equal(c.status, "done");
  assert.deepEqual([...f.sent].sort(), [B, C].sort());
  assert.equal(c.sent, 2);
  assert.equal(c.failed + c.skipped + c.pending, 0);
  assert.deepEqual(c.filters, { onboarded: "no" });
  assert.equal(c.q, tag);
});

test("недавно получавшие исключаются по умолчанию, но не старше 7 дней и не при выключенной опции", async () => {
  await setup();
  const f = fakeSender();
  // B и C уже получили рассылку выше (sent_at = сейчас)
  assert.equal((await previewRecipients({ ...qOnly, filters: { onboarded: "no" }, kind: "custom", excludeRecent: true })).count, 0);
  const off = await previewRecipients({ ...qOnly, filters: { onboarded: "no" }, kind: "custom", excludeRecent: false });
  assert.equal(off.count, 2);
  const withEx = await previewRecipients({ ...qOnly, filters: { onboarded: "no" }, kind: "custom", excludeRecent: true });
  assert.equal(withEx.excludedRecent, 2);
  await pool.query("update public.email_campaign_recipients set sent_at = now() - interval '8 days' where user_id = $1", [B]);
  assert.equal((await previewRecipients({ ...qOnly, filters: { onboarded: "no" }, kind: "custom", excludeRecent: true })).count, 1, "письмо 8-дневной давности уже не мешает");
  void f;
});

async function manualCampaign(kind, recipientIds, extra = {}) {
  const { rows } = await pool.query(
    "insert into public.email_campaigns (kind, subject, body_text, cta_path, footer, total, status) values ($1, $2, 'Текст', '', '', $3, 'sending') returning id",
    [kind, `M-${randomUUID()}`, recipientIds.length]
  );
  const id = rows[0].id;
  subjects.push(id);
  for (const u of recipientIds) await pool.query("insert into public.email_campaign_recipients (campaign_id, user_id, status) values ($1, $2, $3)", [id, u, extra.statuses?.[u] ?? "pending"]);
  return id;
}

test("на момент отправки состояние перепроверяется: подтвердившему почту ссылка не шлётся, ставшему админом — тоже", async () => {
  await setup();
  const U1 = await makeUser("late-confirm", { unconfirmed: true });
  const U2 = await makeUser("late-unconf", { unconfirmed: true });
  const U3 = await makeUser("late-admin", { unconfirmed: true });
  const id = await manualCampaign("verify_link", [U1, U2, U3]);
  await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [U1]);
  await pool.query("update public.profiles set is_admin = true where id = $1", [U3]);
  const f = fakeSender();
  await runCampaign(id, { send: f.send, delayMs: 0 });
  const c = await getCampaign(id);
  assert.deepEqual(f.sent, [U2]);
  assert.equal(c.sent, 1);
  assert.equal(c.skipped, 2);
  assert.ok(c.problems.some((p) => p.error === "почта уже подтверждена"));
  assert.equal(c.status, "done");
});

test("ошибка отправки одному не останавливает остальных и попадает в отчёт", async () => {
  await setup();
  const id = await manualCampaign("custom", [A, B, C]);
  const seen = [];
  await runCampaign(id, {
    delayMs: 0,
    send: async (_c, user) => {
      seen.push(user.id);
      if (user.id === B) throw new Error("550 mailbox unavailable");
    },
  });
  const c = await getCampaign(id);
  assert.equal(seen.length, 3);
  assert.equal(c.sent, 2);
  assert.equal(c.failed, 1);
  assert.match(c.problems.find((p) => p.status === "failed").error, /550 mailbox unavailable/);
});

test("отмена: отправка останавливается, неотправленные помечаются «отменено», ушедшее не откатывается", async () => {
  await setup();
  const id = await manualCampaign("custom", [A, B, C]);
  let n = 0;
  await runCampaign(id, {
    delayMs: 0,
    send: async () => {
      n++;
      if (n === 1) assert.equal(await cancelCampaign(id), true);
    },
  });
  const c = await getCampaign(id);
  assert.equal(n, 1);
  assert.equal(c.status, "cancelled");
  assert.equal(c.sent, 1);
  assert.equal(c.skipped, 2);
  assert.equal(await cancelCampaign(id), false, "повторная отмена ничего не делает");
});

test("возобновление после перезапуска: зависшие «отправляются» не переотправляются (ошибка), очередь дошлётся", async () => {
  await setup();
  const id = await manualCampaign("custom", [A, B, C], { statuses: { [A]: "sending" } });
  const f = fakeSender();
  await resumeCampaigns({ send: f.send, delayMs: 0 });
  const c = await waitDone(id);
  assert.ok(!f.sent.includes(A), "зависшему письму повторной отправки нет");
  assert.deepEqual([...f.sent].sort(), [B, C].sort());
  assert.equal(c.failed, 1);
  assert.equal(c.sent, 2);
});

test("письмо: подстановка имени, приветствие, метка, кнопка со ссылкой, подвал (можно пустой)", () => {
  const m = buildCampaignEmail({ ...content({ ctaPath: "/tariffs", ctaLabel: "К тарифам →" }) }, { name: "Аня", url: "https://x.test" });
  assert.match(m.subject, /^Тема /);
  assert.ok(m.text.startsWith("Аня, привет!"));
  assert.ok(m.text.includes("Привет, Аня! Проверка."));
  assert.ok(m.html.includes("https://x.test/tariffs") && m.html.includes("К тарифам →") && m.html.includes("напоминание") && m.html.includes("Разовое письмо."));
  const bare = buildCampaignEmail({ ...content({ footer: "", eyebrow: "" }) }, { name: "", url: "https://x.test" });
  assert.ok(bare.text.startsWith("Привет!"));
  assert.ok(!bare.html.includes("Разовое письмо."));
});

test("валидация содержимого: границы длины и белый список ссылок кнопки", () => {
  assert.equal(validateCampaignContent("custom", content()), null);
  assert.equal(validateCampaignContent("verify_link", {}), null);
  assert.ok(validateCampaignContent("custom", content({ subject: "x".repeat(201) })));
  assert.ok(validateCampaignContent("custom", content({ bodyText: "" })));
  assert.ok(validateCampaignContent("custom", content({ ctaPath: "/admin" })));
  assert.ok(validateCampaignContent("nope", content()));
});

test("предпросмотр ссылки подтверждения: стандартное письмо с образцовой ссылкой; для своего — оформленное письмо", () => {
  const v = renderCampaignSample("verify_link");
  assert.equal(v.subject, "Подтверди email — ЕГЭ·ПРО");
  assert.ok(v.html.includes("Подтвердить email") && v.html.includes("/verify-email?token="));
  assert.ok(v.text.includes("/verify-email?token="));
  const c = renderCampaignSample("custom", content());
  assert.ok(c.html.includes("Аня, привет!"));
});
