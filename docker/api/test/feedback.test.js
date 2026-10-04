// Обратная связь (docker/api/feedback.js) — против настоящего локального Postgres. Письма подменены:
// настоящий SMTP в тестах не трогаем.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createFeedback, dispatchFeedbackEmails, listMyFeedback, listFeedback, getFeedbackDetail, updateFeedback, replyFeedback,
  getPublicContactInfo, saveContactSettings, resolveContactSettings, setMailSenderForTests, FeedbackError, HOURLY_LIMIT, DEFAULT_SUPPORT_EMAIL,
} from "../feedback.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

const sent = [];
let failMail = false;

async function deleteFeedbackRows(where, params) {
  // штатно обращения не удаляются (триггер) — для уборки за тестами отключаем его на время
  await pool.query("alter table public.feedback_messages disable trigger feedback_messages_no_delete");
  try {
    await pool.query(`delete from public.feedback_messages where ${where}`, params);
  } finally {
    await pool.query("alter table public.feedback_messages enable trigger feedback_messages_no_delete");
  }
}

beforeEach(async () => {
  sent.length = 0;
  failMail = false;
  setMailSenderForTests(async (m) => {
    if (failMail) throw new Error("SMTP недоступен");
    sent.push(m);
  });
  await pool.query("delete from public.app_settings where key = 'contacts'");
});
after(async () => {
  setMailSenderForTests(null);
  await pool.query("delete from public.app_settings where key = 'contacts'");
  await deleteFeedbackRows("email like '%@fbtest.example'", []);
  await pool.end();
});

let n = 0;
const mail = () => `guest${Date.now()}${n++}@fbtest.example`;
const base = (over = {}) => ({ topic: "payment", name: "Аня", email: mail(), message: "Не проходит оплата картой, пишет ошибку.", consent: true, source: "/tariffs", ...over });
const ip = () => `10.${n++ % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test("приём: обращение пишется в БД, в журнале событие «created», у гостя почта из формы", async () => {
  const r = await createFeedback(base({ email: "Anya@FbTest.example " }), { ip: ip(), userAgent: "UA" });
  assert.equal(r.saved, true);
  const d = await getFeedbackDetail(r.id);
  assert.equal(d.status, "new");
  assert.equal(d.email, "anya@fbtest.example");
  assert.equal(d.topic, "payment");
  assert.deepEqual(d.events.map((e) => e.type), ["created"]);
  assert.equal(d.context.userAgent, "UA");
});

test("валидация: тема, длина, согласие, почта", async () => {
  const c = { ip: ip() };
  await assert.rejects(() => createFeedback(base({ topic: "nope" }), c), FeedbackError);
  await assert.rejects(() => createFeedback(base({ message: "коротко" }), c), FeedbackError);
  await assert.rejects(() => createFeedback(base({ message: "а".repeat(3001) }), c), FeedbackError);
  await assert.rejects(() => createFeedback(base({ consent: false }), c), FeedbackError);
  await assert.rejects(() => createFeedback(base({ email: "не-почта" }), c), FeedbackError);
});

test("боты: заполненная ловушка или слишком быстрая отправка — молча «принято», в БД ничего нет", async () => {
  const before = (await pool.query("select count(*)::int as n from public.feedback_messages")).rows[0].n;
  assert.deepEqual(await createFeedback(base({ website: "http://spam" }), { ip: ip() }), { id: null, saved: false });
  assert.deepEqual(await createFeedback(base({ elapsedMs: 500 }), { ip: ip() }), { id: null, saved: false });
  assert.equal((await pool.query("select count(*)::int as n from public.feedback_messages")).rows[0].n, before);
});

test("лимит: больше 5 обращений в час с одной почты — 429", async () => {
  const email = mail();
  for (let i = 0; i < HOURLY_LIMIT; i++) await createFeedback(base({ email }), { ip: ip() });
  await assert.rejects(() => createFeedback(base({ email }), { ip: ip() }), (e) => e.status === 429);
});

test("вошедший: почта берётся из аккаунта, а не из формы; обращение видно в «моих»", async () => {
  const id = await createTestUser();
  try {
    const { rows } = await pool.query("select email from auth.users where id = $1", [id]);
    const r = await createFeedback(base({ email: "other@fbtest.example" }), { userId: id, ip: ip() });
    const d = await getFeedbackDetail(r.id);
    assert.equal(d.email, rows[0].email);
    assert.equal(d.userId, id);
    assert.equal(d.context.tariff, "free");
    const mine = await listMyFeedback(id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, r.id);
  } finally {
    await deleteTestUser(id);
    await deleteFeedbackRows("email = '[удалено]'", []);
  }
});

test("письма: команде на почту поддержки с Reply-To автора + подтверждение автору; результат — в журнале", async () => {
  const r = await createFeedback(base({ email: "author@fbtest.example" }), { ip: ip() });
  await dispatchFeedbackEmails(r.id, { siteUrl: "https://example.org" });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, DEFAULT_SUPPORT_EMAIL);
  assert.equal(sent[0].replyTo, "author@fbtest.example");
  assert.match(sent[0].subject, new RegExp(`№${r.id}\\]`));
  assert.equal(sent[1].to, "author@fbtest.example");
  assert.equal(sent[1].replyTo, DEFAULT_SUPPORT_EMAIL);
  assert.match(sent[1].text, /в течение одного дня/);
  const d = await getFeedbackDetail(r.id);
  assert.deepEqual(d.events.map((e) => e.type), ["created", "team_notified", "ack_sent"]);
  assert.equal(d.teamNotified, "ok");
  assert.equal(d.ackSent, "ok");
});

test("письма: SMTP упал — обращение не потеряно, сбой записан в журнал и виден в фильтре «письмо не ушло»", async () => {
  failMail = true;
  const r = await createFeedback(base(), { ip: ip() });
  await dispatchFeedbackEmails(r.id);
  const d = await getFeedbackDetail(r.id);
  assert.equal(d.status, "new");
  assert.deepEqual(d.events.map((e) => e.type), ["created", "team_notify_failed", "ack_failed"]);
  assert.equal(d.teamNotified, "failed");
  assert.match(d.teamNotifyError, /SMTP/);
  const failed = await listFeedback({ delivery: "failed", pageSize: 100 });
  assert.ok(failed.items.some((i) => i.id === r.id));
});

test("админ: смена статуса и заметка логируются (кто, что, было→стало), закрытие ставит closed_at", async () => {
  const admin = await createTestUser({ isAdmin: true });
  try {
    const r = await createFeedback(base(), { ip: ip() });
    let d = await updateFeedback(r.id, admin, { status: "in_progress", note: "смотрю платёж" });
    assert.equal(d.status, "in_progress");
    assert.equal(d.adminNote, "смотрю платёж");
    d = await updateFeedback(r.id, admin, { status: "closed" });
    assert.ok(d.closedAt);
    const ev = d.events.filter((e) => e.type === "status_changed").map((e) => [e.data.from, e.data.to]);
    assert.deepEqual(ev, [["new", "in_progress"], ["in_progress", "closed"]]);
    assert.ok(d.events.find((e) => e.type === "note_changed").actor);
    d = await updateFeedback(r.id, admin, { status: "closed" });
    assert.equal(d.events.filter((e) => e.type === "status_changed").length, 2, "без изменений — без новых событий");
    await assert.rejects(() => updateFeedback(r.id, admin, { status: "weird" }), FeedbackError);
  } finally {
    await deleteTestUser(admin);
  }
});

test("ответ из админки: письмо автору с Reply-To, статус «Отвечено», в «моих» виден текст ответа; сбой — в журнале и ошибкой", async () => {
  const admin = await createTestUser({ isAdmin: true });
  const user = await createTestUser();
  try {
    const r = await createFeedback(base(), { userId: user, ip: ip() });
    failMail = true;
    await assert.rejects(() => replyFeedback(r.id, admin, "Проверили, всё работает."), (e) => e.status === 502);
    assert.equal((await getFeedbackDetail(r.id)).status, "new", "неотправленный ответ статус не меняет");
    assert.ok((await getFeedbackDetail(r.id)).events.some((e) => e.type === "reply_failed"));
    failMail = false;
    const d = await replyFeedback(r.id, admin, "Проверили, всё работает.");
    assert.equal(d.status, "answered");
    assert.ok(d.firstResponseAt);
    assert.equal(sent.at(-1).replyTo, DEFAULT_SUPPORT_EMAIL);
    assert.match(sent.at(-1).text, /Проверили, всё работает\./);
    const mine = await listMyFeedback(user);
    assert.equal(mine[0].replies[0].text, "Проверили, всё работает.");
    await assert.rejects(() => replyFeedback(r.id, admin, " "), FeedbackError);
  } finally {
    await deleteTestUser(admin);
    await deleteTestUser(user);
    await deleteFeedbackRows("email = '[удалено]'", []);
  }
});

test("список: фильтры по статусу/теме/поиску/датам, сортировка, пагинация, просрочка", async () => {
  const marker = `маркер${Date.now()}`;
  const a = await createFeedback(base({ topic: "bug", message: `Не открывается страница ${marker}` }), { ip: ip() });
  const b = await createFeedback(base({ topic: "suggestion", message: `Добавьте тёмную тему ${marker}` }), { ip: ip() });
  const c = await createFeedback(base({ topic: "bug", message: `Ошибка в задании ${marker}` }), { ip: ip() });
  await pool.query("update public.feedback_messages set status = 'answered' where id = $1", [b.id]);
  await pool.query("update public.feedback_messages set created_at = now() - interval '30 hours' where id = $1", [c.id]);

  const byText = await listFeedback({ q: marker, pageSize: 100 });
  assert.deepEqual(byText.items.map((i) => i.id).sort(), [a.id, b.id, c.id].sort());
  assert.deepEqual((await listFeedback({ q: marker, topic: "bug", pageSize: 100 })).items.map((i) => i.id).sort(), [a.id, c.id].sort());
  assert.deepEqual((await listFeedback({ q: marker, status: "answered" })).items.map((i) => i.id), [b.id]);
  assert.equal((await listFeedback({ q: marker, status: "open", pageSize: 100 })).total, 2);
  assert.deepEqual((await listFeedback({ q: `#${a.id}` })).items.map((i) => i.id), [a.id]);

  const overdue = await listFeedback({ q: marker, overdue: "1", pageSize: 100 });
  assert.deepEqual(overdue.items.map((i) => i.id), [c.id], "просрочено только то, что без ответа дольше суток");
  assert.equal(overdue.items[0].overdue, true);

  const asc = await listFeedback({ q: marker, sort: "created", dir: "asc", pageSize: 100 });
  assert.equal(asc.items[0].id, c.id, "самое старое первым");
  const byTopic = await listFeedback({ q: marker, sort: "topic", dir: "asc", pageSize: 100 });
  assert.equal(byTopic.items[0].topic, "bug");
  const page = await listFeedback({ q: marker, sort: "id", dir: "asc", pageSize: 5, page: 1 });
  assert.equal(page.items.length, 3);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await listFeedback({ q: marker, from: today, to: today, pageSize: 100 })).items.some((i) => i.id === a.id));
  assert.equal((await listFeedback({ q: marker, from: "2999-01-01" })).total, 0);
  assert.ok(byText.counts.new >= 2 && byText.overdue >= 1);
});

test("защита от потери: обращение нельзя удалить; при удалении аккаунта стираются почта, имя и текст, а запись и журнал остаются", async () => {
  const user = await createTestUser();
  const admin = await createTestUser({ isAdmin: true });
  const r = await createFeedback(base({ name: "Борис" }), { userId: user, ip: ip() });
  try {
    await assert.rejects(() => pool.query("delete from public.feedback_messages where id = $1", [r.id]), /не удаляются/);
    await updateFeedback(r.id, admin, { status: "in_progress" });
    await deleteTestUser(user);
    const d = await getFeedbackDetail(r.id);
    assert.equal(d.userId, null);
    assert.equal(d.email, "[удалено]");
    assert.equal(d.name, null);
    assert.match(d.message, /удалено по запросу/);
    assert.ok(d.events.length >= 2, "журнал сохранён");
    await assert.rejects(() => replyFeedback(r.id, admin, "Привет"), (e) => e.status === 409);
  } finally {
    await deleteTestUser(admin);
    await deleteFeedbackRows("id = $1", [r.id]);
  }
});

test("контакты: по умолчанию почта поддержки и ни одного канала; каналы только по своим доменам и https", async () => {
  const info = await getPublicContactInfo();
  assert.equal(info.supportEmail, "support@ege-tutor.ru");
  assert.deepEqual(info.channels, []);
  assert.equal(info.replyWithinHours, 24);

  await saveContactSettings({ supportEmail: "Help@Ege-Tutor.ru", channels: { whatsapp: { enabled: true, url: "https://wa.me/message/ABC123" }, telegram: { enabled: false, url: "" }, vk: { enabled: false, url: "" } } }, null);
  const after = await getPublicContactInfo();
  assert.equal(after.supportEmail, "help@ege-tutor.ru");
  assert.deepEqual(after.channels.map((c) => [c.id, c.url]), [["whatsapp", "https://wa.me/message/ABC123"]]);

  await assert.rejects(() => saveContactSettings({ supportEmail: "help@ege-tutor.ru", channels: { whatsapp: { enabled: true, url: "http://wa.me/x" } } }, null), FeedbackError);
  await assert.rejects(() => saveContactSettings({ supportEmail: "help@ege-tutor.ru", channels: { telegram: { enabled: true, url: "https://evil.example/x" } } }, null), FeedbackError);
  await assert.rejects(() => saveContactSettings({ supportEmail: "help@ege-tutor.ru", channels: { vk: { enabled: true, url: "" } } }, null), FeedbackError);
  await assert.rejects(() => saveContactSettings({ supportEmail: "не-почта", channels: {} }, null), FeedbackError);

  // подготовка к Telegram/VK: включаются так же, ссылкой
  await saveContactSettings({ supportEmail: "help@ege-tutor.ru", channels: { telegram: { enabled: true, url: "https://t.me/egepro_support" }, vk: { enabled: true, url: "https://vk.com/egepro" } } }, null);
  assert.deepEqual((await getPublicContactInfo()).channels.map((c) => c.id), ["telegram", "vk"]);
  assert.equal((await resolveContactSettings()).supportEmail, "help@ege-tutor.ru");
});
