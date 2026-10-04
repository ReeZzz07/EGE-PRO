// Отзывы (docker/api/reviews.js) — против настоящего локального Postgres.
// Допуск: онбординг + диагностика + 5 обращений к репетитору; низкие оценки приватны; правка → снова модерация.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getReviewEligibility, saveMyReview, getMyReviewState, deleteMyReview, listPublicReviews, listAdminReviews, moderateReview, statusFor, defaultDisplayName, ReviewError } from "../reviews.js";
import { createTestUser, deleteTestUser, insertAiMessage, pool } from "./helpers.js";

after(() => pool.end());

const BODY = "Репетитор объясняет понятно, диагностика сразу показала слабые темы.";

async function addDiagnostic(id) {
  await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [id]);
}
async function addAi(id, n) {
  for (let i = 0; i < n; i++) await insertAiMessage(id, { mode: "chat", role: "user" });
}
/** Пользователь, прошедший все три условия */
async function eligibleUser() {
  const id = await createTestUser({ onboarded: true });
  await addDiagnostic(id);
  await addAi(id, 5);
  return id;
}
const input = (over = {}) => ({ rating: 5, body: BODY, displayName: "Анна К.", consentPublic: true, ...over });

test("допуск: нужны все три условия, считается прогресс", async () => {
  const id = await createTestUser();
  try {
    let e = await getReviewEligibility(id);
    assert.deepEqual([e.eligible, e.onboarding, e.diagnostic, e.aiMessages, e.required], [false, false, false, 0, 5]);
    await pool.query("update public.profiles set onboarded_at = now() where id = $1", [id]);
    await addDiagnostic(id);
    await addAi(id, 4);
    e = await getReviewEligibility(id);
    assert.equal(e.eligible, false, "4 обращения из 5");
    assert.equal(e.aiMessages, 4);
    await addAi(id, 1);
    // ответы ассистента не считаются обращениями
    await insertAiMessage(id, { mode: "chat", role: "assistant" });
    e = await getReviewEligibility(id);
    assert.equal(e.eligible, true);
    assert.equal(e.aiMessages, 5);
  } finally {
    await deleteTestUser(id);
  }
});

test("допуск: без онбординга или без диагностики — нельзя, админу — нельзя", async () => {
  const noOnb = await createTestUser();
  const noDiag = await createTestUser({ onboarded: true });
  const admin = await createTestUser({ isAdmin: true, onboarded: true });
  try {
    await addDiagnostic(noOnb);
    await addAi(noOnb, 5);
    await addAi(noDiag, 5);
    await addDiagnostic(admin);
    await addAi(admin, 5);
    assert.equal((await getReviewEligibility(noOnb)).eligible, false);
    assert.equal((await getReviewEligibility(noDiag)).eligible, false);
    assert.equal((await getReviewEligibility(admin)).eligible, false);
    await assert.rejects(() => saveMyReview(noDiag, input()), (e) => e instanceof ReviewError && e.status === 403);
  } finally {
    await deleteTestUser(noOnb);
    await deleteTestUser(noDiag);
    await deleteTestUser(admin);
  }
});

test("сохранение: оценка 4–5 с согласием → pending; без согласия или 1–3 → private", async () => {
  assert.equal(statusFor({ rating: 5, consentPublic: true }), "pending");
  assert.equal(statusFor({ rating: 4, consentPublic: false }), "private");
  assert.equal(statusFor({ rating: 3, consentPublic: true }), "private");
  const id = await eligibleUser();
  try {
    assert.equal((await saveMyReview(id, input())).status, "pending");
    assert.equal((await saveMyReview(id, input({ rating: 2 }))).status, "private");
    const st = await getMyReviewState(id);
    assert.equal(st.review.rating, 2);
    assert.equal(st.eligibility.eligible, true);
    assert.equal((await pool.query("select count(*)::int as n from public.reviews where user_id = $1", [id])).rows[0].n, 1, "один отзыв на пользователя");
  } finally {
    await deleteTestUser(id);
  }
});

test("валидация: оценка, длина текста, имя, чужой предмет", async () => {
  const id = await eligibleUser();
  try {
    await assert.rejects(() => saveMyReview(id, input({ rating: 0 })), ReviewError);
    await assert.rejects(() => saveMyReview(id, input({ rating: 6 })), ReviewError);
    await assert.rejects(() => saveMyReview(id, input({ body: "коротко" })), ReviewError);
    await assert.rejects(() => saveMyReview(id, input({ body: "а".repeat(1501) })), ReviewError);
    await assert.rejects(() => saveMyReview(id, input({ displayName: "А" })), ReviewError);
    await assert.rejects(() => saveMyReview(id, input({ subject: "no-such-subject" })), ReviewError);
    const own = (await pool.query("select subject from public.profile_subjects where user_id = $1 limit 1", [id])).rows[0]?.subject;
    if (own) assert.equal((await saveMyReview(id, input({ subject: own }))).subject, own);
  } finally {
    await deleteTestUser(id);
  }
});

test("модерация: одобрить → в публичной ленте без user_id; правка текста → снова pending и в ленте нет", async () => {
  const id = await eligibleUser();
  try {
    await saveMyReview(id, input());
    const rid = (await pool.query("select id from public.reviews where user_id = $1", [id])).rows[0].id;
    assert.equal((await listPublicReviews()).reviews.some((r) => r.id === rid), false, "pending в ленту не попадает");
    const m = await moderateReview(rid, { action: "approve" });
    assert.equal(m.status, "approved");
    const pub = await listPublicReviews();
    const mine = pub.reviews.find((r) => r.id === rid);
    assert.ok(mine);
    assert.equal(mine.displayName, "Анна К.");
    assert.equal("userId" in mine || "user_id" in mine || "email" in mine, false, "персональных данных в ленте нет");
    assert.ok(pub.count >= 1 && pub.average >= 1);

    await moderateReview(rid, { action: "reply", reply: "Спасибо!" });
    assert.equal((await listPublicReviews()).reviews.find((r) => r.id === rid).adminReply, "Спасибо!");

    const edited = await saveMyReview(id, input({ body: BODY + " Дополнение после недели занятий." }));
    assert.equal(edited.status, "pending");
    assert.equal(edited.adminReply, null, "ответ к старому тексту сброшен");
    assert.equal((await listPublicReviews()).reviews.some((r) => r.id === rid), false);
  } finally {
    await deleteTestUser(id);
  }
});

test("модерация: низкую оценку и отзыв без согласия опубликовать нельзя; reject/unpublish работают", async () => {
  const low = await eligibleUser();
  const nocons = await eligibleUser();
  const ok = await eligibleUser();
  try {
    await saveMyReview(low, input({ rating: 2 }));
    await saveMyReview(nocons, input({ consentPublic: false }));
    await saveMyReview(ok, input());
    const ids = async (u) => (await pool.query("select id from public.reviews where user_id = $1", [u])).rows[0].id;
    const lowId = await ids(low);
    const noconsId = await ids(nocons);
    await assert.rejects(() => moderateReview(lowId, { action: "approve" }), (e) => e.status === 409);
    await assert.rejects(() => moderateReview(noconsId, { action: "approve" }), (e) => e.status === 409);
    const okId = await ids(ok);
    assert.equal((await moderateReview(okId, { action: "approve" })).status, "approved");
    assert.equal((await moderateReview(okId, { action: "unpublish" })).status, "pending");
    assert.equal((await moderateReview(okId, { action: "reject" })).status, "rejected");
    await assert.rejects(() => moderateReview(okId, { action: "boom" }), ReviewError);
    await assert.rejects(() => moderateReview("00000000-0000-0000-0000-000000000000", { action: "reject" }), (e) => e.status === 404);
  } finally {
    await deleteTestUser(low);
    await deleteTestUser(nocons);
    await deleteTestUser(ok);
  }
});

test("админский список: счётчики по статусам, фильтр, pending первыми", async () => {
  const a = await eligibleUser();
  const b = await eligibleUser();
  try {
    await saveMyReview(a, input({ rating: 1 }));
    await saveMyReview(b, input());
    const all = await listAdminReviews();
    assert.ok(all.counts.pending >= 1 && all.counts.private >= 1);
    assert.equal(all.reviews[0].status, "pending");
    const onlyPrivate = await listAdminReviews("private");
    assert.ok(onlyPrivate.reviews.every((r) => r.status === "private"));
    assert.ok(onlyPrivate.reviews.every((r) => typeof r.email === "string"));
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
  }
});

test("удаление своего отзыва и каскад при удалении пользователя", async () => {
  const id = await eligibleUser();
  const other = await eligibleUser();
  try {
    await saveMyReview(id, input());
    await deleteMyReview(id);
    assert.equal((await getMyReviewState(id)).review, null);
    await saveMyReview(other, input());
  } finally {
    await deleteTestUser(id);
    await deleteTestUser(other);
  }
  assert.equal((await pool.query("select count(*)::int as n from public.reviews where user_id = $1", [other])).rows[0].n, 0);
});

test("имя по умолчанию: «Анна Петрова» → «Анна П.»", () => {
  assert.equal(defaultDisplayName("Анна Петрова"), "Анна П.");
  assert.equal(defaultDisplayName("  иван  "), "иван");
  assert.equal(defaultDisplayName(null), "");
});
