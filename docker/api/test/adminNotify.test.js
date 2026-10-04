// Уведомления администраторам (docker/api/adminNotify.js): письма об отзывах — на почту отзывов (info@), а не
// на почту поддержки; значки; ежедневные сводки. Письма подменены, настоящий SMTP не трогаем.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { describeReview, notifyReviewSubmitted, getAdminBadges, runAdminDigests, setNotifySenderForTests, whenNotificationsSettled } from "../adminNotify.js";
import { saveMyReview } from "../reviews.js";
import { createFeedback, saveContactSettings, resolveContactSettings, DEFAULT_REVIEW_NOTIFY_EMAIL, DEFAULT_SUPPORT_EMAIL, FeedbackError } from "../feedback.js";
import { createTestUser, deleteTestUser, insertAiMessage, pool } from "./helpers.js";

const sent = [];
let failMail = false;

async function deleteFeedbackRows(where, params = []) {
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
  setNotifySenderForTests(async (m) => {
    if (failMail) throw new Error("SMTP недоступен");
    sent.push(m);
  });
  await pool.query("delete from public.app_settings where key in ('contacts', 'admin_digest')");
});
after(async () => {
  setNotifySenderForTests(null);
  await whenNotificationsSettled();
  await pool.query("delete from public.app_settings where key in ('contacts', 'admin_digest')");
  await deleteFeedbackRows("email like '%@notifytest.example'");
  await pool.end();
});

const BODY = "Репетитор объясняет понятно, диагностика сразу показала слабые темы.";
async function eligibleUser() {
  const id = await createTestUser({ onboarded: true });
  await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [id]);
  for (let i = 0; i < 5; i++) await insertAiMessage(id, { mode: "chat", role: "user" });
  return id;
}
const input = (over = {}) => ({ rating: 5, body: BODY, displayName: "Анна К.", consentPublic: true, ...over });
let n = 0;
const base = (over = {}) => ({ topic: "payment", name: "Аня", email: `g${Date.now()}${n++}@notifytest.example`, message: "Не проходит оплата картой, пишет ошибку.", consent: true, ...over });
const ip = () => `10.${n++ % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test("настройки: почта для отзывов по умолчанию info@, отдельно от support@; меняется, проверяется", async () => {
  const s = await resolveContactSettings();
  assert.equal(s.reviewNotifyEmail, "info@ege-tutor.ru");
  assert.equal(DEFAULT_REVIEW_NOTIFY_EMAIL, "info@ege-tutor.ru");
  assert.notEqual(s.reviewNotifyEmail, s.supportEmail);
  const saved = await saveContactSettings({ supportEmail: "support@ege-tutor.ru", reviewNotifyEmail: "Reviews@Ege-Tutor.ru", channels: {} }, null);
  assert.equal(saved.reviewNotifyEmail, "reviews@ege-tutor.ru");
  await assert.rejects(() => saveContactSettings({ supportEmail: "support@ege-tutor.ru", reviewNotifyEmail: "не-почта", channels: {} }, null), FeedbackError);
  const blank = await saveContactSettings({ supportEmail: "support@ege-tutor.ru", reviewNotifyEmail: "", channels: {} }, null);
  assert.equal(blank.reviewNotifyEmail, "info@ege-tutor.ru");
});

test("describeReview: на модерации / только для команды (1–3) / без согласия", () => {
  assert.match(describeReview({ status: "pending", rating: 5, displayName: "Анна К." }).subject, /^Новый отзыв на модерации — 5★ Анна К\.$/);
  assert.match(describeReview({ status: "private", rating: 2, displayName: "Борис" }).subject, /2★ \(только для команды\)/);
  assert.match(describeReview({ status: "private", rating: 5, displayName: "Вера" }).subject, /без согласия на публикацию/);
});

test("новый отзыв: письмо уходит на почту отзывов (info@), НЕ на почту поддержки; правка — «Изменён:», повторное сохранение без правок — тишина", async () => {
  const id = await eligibleUser();
  try {
    await saveMyReview(id, input());
    await whenNotificationsSettled();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "info@ege-tutor.ru");
    assert.notEqual(sent[0].to, DEFAULT_SUPPORT_EMAIL);
    assert.ok(!sent[0].via, "служебное письмо идёт через основной SMTP");
    assert.match(sent[0].subject, /Новый отзыв на модерации/);
    assert.match(sent[0].text, /Репетитор объясняет понятно/);

    await saveMyReview(id, input()); // без изменений
    await whenNotificationsSettled();
    assert.equal(sent.length, 1);

    await saveMyReview(id, input({ body: BODY + " Дополнение после недели." }));
    await whenNotificationsSettled();
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /^Изменён: /);
  } finally {
    await deleteTestUser(id);
  }
});

test("отзыв 1–3 или без согласия: письмо сразу, с пометкой «только для команды»; адрес берётся из настроек", async () => {
  await saveContactSettings({ supportEmail: "support@ege-tutor.ru", reviewNotifyEmail: "owner@ege-tutor.ru", channels: {} }, null);
  const low = await eligibleUser();
  const noConsent = await eligibleUser();
  try {
    await saveMyReview(low, input({ rating: 2 }));
    await saveMyReview(noConsent, input({ consentPublic: false }));
    await whenNotificationsSettled();
    assert.equal(sent.length, 2);
    assert.ok(sent.every((m) => m.to === "owner@ege-tutor.ru"));
    assert.ok(sent.some((m) => /2★ \(только для команды\)/.test(m.subject)));
    assert.ok(sent.some((m) => /без согласия на публикацию/.test(m.subject)));
  } finally {
    await deleteTestUser(low);
    await deleteTestUser(noConsent);
  }
});

test("сбой SMTP при уведомлении об отзыве не ломает сохранение отзыва", async () => {
  const id = await eligibleUser();
  try {
    failMail = true;
    const r = await saveMyReview(id, input());
    await whenNotificationsSettled();
    assert.equal(r.status, "pending");
    assert.equal(sent.length, 0);
    assert.equal(await notifyReviewSubmitted({ review: { status: "pending", rating: 5, displayName: "А", body: "x", consentPublic: true }, authorEmail: "a@b.ru", isEdit: false }), false);
  } finally {
    await deleteTestUser(id);
  }
});

test("значки: новые и просроченные обращения, не ушедшие письма, отзывы на модерации", async () => {
  const before = await getAdminBadges();
  const a = await createFeedback(base(), { ip: ip() });
  const b = await createFeedback(base(), { ip: ip() });
  await pool.query("update public.feedback_messages set created_at = now() - interval '30 hours' where id = $1", [b.id]);
  await pool.query("update public.feedback_messages set team_notify_error = 'SMTP' where id = $1", [a.id]);
  const id = await eligibleUser();
  try {
    await saveMyReview(id, input());
    await whenNotificationsSettled();
    const after = await getAdminBadges();
    assert.equal(after.feedbackNew - before.feedbackNew, 2);
    assert.equal(after.feedbackOverdue - before.feedbackOverdue, 1);
    assert.equal(after.feedbackDeliveryFailed - before.feedbackDeliveryFailed, 1);
    assert.equal(after.reviewsPending - before.reviewsPending, 1);
    assert.equal(after.total, after.feedbackNew + after.reviewsPending);
  } finally {
    await deleteTestUser(id);
  }
});

const morning = new Date("2026-10-05T07:00:00Z"); // 10:00 по Москве

test("сводки: по обращениям — на почту поддержки (через ящик поддержки), по отзывам — на почту отзывов; раз в сутки", async () => {
  const fb = await createFeedback(base(), { ip: ip() });
  await pool.query("update public.feedback_messages set created_at = now() - interval '30 hours' where id = $1", [fb.id]);
  const id = await eligibleUser();
  try {
    await saveMyReview(id, input());
    await whenNotificationsSettled();
    sent.length = 0;

    const r = await runAdminDigests({ now: morning });
    assert.deepEqual(r, { feedback: true, reviews: true });
    const feedbackMail = sent.find((m) => m.to === DEFAULT_SUPPORT_EMAIL);
    const reviewsMail = sent.find((m) => m.to === DEFAULT_REVIEW_NOTIFY_EMAIL);
    assert.ok(feedbackMail && reviewsMail);
    assert.equal(feedbackMail.via, "support");
    assert.match(feedbackMail.subject, /Обращения без ответа: \d+, просрочено \d+/);
    assert.match(feedbackMail.text, new RegExp(`№${fb.id} .*ПРОСРОЧЕНО`));
    assert.doesNotMatch(feedbackMail.text, /Отзыв/i, "в сводке по обращениям отзывов нет");
    assert.match(reviewsMail.subject, /Отзывы на модерации: \d+/);
    assert.doesNotMatch(reviewsMail.text, /Обращени/, "в сводке по отзывам обращений нет");
    assert.equal(sent.filter((m) => m.to === DEFAULT_SUPPORT_EMAIL).every((m) => !/отзыв/i.test(m.subject)), true);

    // тот же день — повторно не шлём
    sent.length = 0;
    assert.deepEqual(await runAdminDigests({ now: new Date(morning.getTime() + 3 * 3600 * 1000) }), { feedback: false, reviews: false });
    assert.equal(sent.length, 0);
    // следующий день — снова
    assert.deepEqual(await runAdminDigests({ now: new Date(morning.getTime() + 24 * 3600 * 1000) }), { feedback: true, reviews: true });
  } finally {
    await deleteTestUser(id);
  }
});

test("сводки: ночью (до 9:00 по Москве) не шлём; сбой отправки не «съедает» день — следующий прогон повторит", async () => {
  const fb = await createFeedback(base(), { ip: ip() });
  void fb;
  const night = new Date("2026-10-05T01:00:00Z"); // 04:00 по Москве
  assert.deepEqual(await runAdminDigests({ now: night }), { feedback: false, reviews: false });
  assert.equal(sent.length, 0);

  failMail = true;
  assert.equal((await runAdminDigests({ now: morning })).feedback, false);
  failMail = false;
  const retry = await runAdminDigests({ now: new Date(morning.getTime() + 15 * 60 * 1000) });
  assert.equal(retry.feedback, true, "после сбоя день не помечен — повтор отправляет");
});

test("сводки: нечего сообщать — письма нет", async () => {
  await deleteFeedbackRows("status in ('new','in_progress')");
  await pool.query("delete from public.reviews where status = 'pending'");
  const r = await runAdminDigests({ now: morning });
  assert.deepEqual(r, { feedback: false, reviews: false });
  assert.equal(sent.length, 0);
});
