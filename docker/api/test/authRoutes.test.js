// /auth/signup и /auth/login — тесты идут по-настоящему через HTTP, на живой стек
// (docker compose up), а не импортом server.js напрямую: тот при импорте сам поднимает Express и
// слушает порт (побочный эффект верхнего уровня), так что "просто заимпортировать функцию роута"
// не выйдет — весь смысл этих двух роутов в HTTP-контракте (коды статусов, форма ответа), а не в
// отдельно вызываемой функции. base URL — тот же localhost:3100 (через прокси web → api), которым
// пользовался весь ручной QA этой сессии.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { deleteTestUser, pool } from "./helpers.js";
import { createActionToken } from "../authTokens.js";

const BASE_URL = process.env.API_TEST_BASE_URL || "http://localhost:3100";
const TEST_EMAIL_DOMAIN = "authroutes-test.local";

function testEmail() {
  return `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

// age/gender стали обязательными в POST /auth/signup (см. server.js) — большинство тестов здесь
// проверяют другое поведение (email/пароль, повторная регистрация и т.п.), поэтому подставляем
// валидные дефолты, если тест их явно не передал, а не дублируем в каждом вызове ниже. Тесты,
// которым важно именно отсутствие/некорректность age/gender, передают их явно (в т.ч. undefined),
// это переопределяет дефолт через spread.
async function signup(body) {
  const resp = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ age: 17, gender: "m", ...body }),
  });
  return { status: resp.status, json: await resp.json() };
}

async function login(body) {
  const resp = await fetch(`${BASE_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: resp.status, json: await resp.json() };
}

async function verifyEmail(body) {
  const resp = await fetch(`${BASE_URL}/auth/verify-email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: resp.status, json: await resp.json() };
}

async function resendVerification(body) {
  const resp = await fetch(`${BASE_URL}/auth/resend-verification`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: resp.status, json: await resp.json() };
}

/** signup() больше не подтверждает email (см. POST /auth/signup) — тесты, которым нужен рабочий
 *  аккаунт без прохождения по ссылке из письма, подтверждают его прямым SQL, как и остальной QA
 *  в этом проекте. */
async function confirmEmail(userId) {
  await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [userId]);
}

after(() => pool.end());

test("/auth/signup: без email или password — 400 с понятным сообщением, ничего не создаёт", async () => {
  const r1 = await signup({ email: "", password: "pw" });
  assert.equal(r1.status, 400);
  assert.match(r1.json.error.message, /email и password обязательны/);

  const r2 = await signup({ password: "pw" });
  assert.equal(r2.status, 400);

  const r3 = await signup({ email: testEmail() });
  assert.equal(r3.status, 400);
});

test("/auth/signup: успех — 200, needsVerification=true, БЕЗ access_token (email ещё не подтверждён)", async () => {
  const email = testEmail();
  const r = await signup({ email, password: "testpass123", full_name: "Тест Тестов" });
  try {
    assert.equal(r.status, 200);
    assert.equal(r.json.error, null);
    assert.equal(r.json.data.user.email, email);
    assert.ok(r.json.data.user.id);
    assert.equal(r.json.needsVerification, true);
    assert.equal(r.json.access_token, undefined);
  } finally {
    await deleteTestUser(r.json.data.user.id);
  }
});

test("/auth/signup: создаёт профиль автоматически (через триггер БД), не только запись в auth.users", async () => {
  const email = testEmail();
  const r = await signup({ email, password: "testpass123" });
  try {
    const { rows } = await pool.query("select id, tariff_id, is_admin from public.profiles where id = $1", [r.json.data.user.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tariff_id, "free");
    assert.equal(rows[0].is_admin, false);
  } finally {
    await deleteTestUser(r.json.data.user.id);
  }
});

test("/auth/signup: повторная регистрация с тем же email — 400, понятное сообщение", async () => {
  const email = testEmail();
  const first = await signup({ email, password: "testpass123" });
  try {
    const second = await signup({ email, password: "другой-пароль" });
    assert.equal(second.status, 400);
    assert.match(second.json.error.message, /уже существует/);
  } finally {
    await deleteTestUser(first.json.data.user.id);
  }
});

test("/auth/login: неподтверждённый email — 403, code EMAIL_NOT_CONFIRMED (даже с верным паролем)", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const r = await login({ email, password: "testpass123" });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "EMAIL_NOT_CONFIRMED");
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/login: верные email+пароль после подтверждения email — 200, access_token валиден", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    await confirmEmail(su.json.data.user.id);
    const r = await login({ email, password: "testpass123" });
    assert.equal(r.status, 200);
    assert.equal(r.json.error, null);
    assert.equal(r.json.data.user.email, email);
    const payload = jwt.decode(r.json.access_token);
    assert.equal(payload.sub, su.json.data.user.id);
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/verify-email: валидный токен — подтверждает email, отдаёт рабочий access_token, дальше логин проходит", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const token = await createActionToken(su.json.data.user.id, "verify_email");
    const r = await verifyEmail({ token });
    assert.equal(r.status, 200);
    assert.equal(r.json.error, null);
    assert.equal(r.json.data.user.email, email);
    const payload = jwt.decode(r.json.access_token);
    assert.equal(payload.sub, su.json.data.user.id);

    const login2 = await login({ email, password: "testpass123" });
    assert.equal(login2.status, 200);
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/verify-email: токен нельзя использовать дважды", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const token = await createActionToken(su.json.data.user.id, "verify_email");
    const first = await verifyEmail({ token });
    const second = await verifyEmail({ token });
    assert.equal(first.status, 200);
    assert.equal(second.status, 400);
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/verify-email: неизвестный/пустой токен — 400, не падает", async () => {
  const r1 = await verifyEmail({ token: "not-a-real-token" });
  assert.equal(r1.status, 400);
  const r2 = await verifyEmail({});
  assert.equal(r2.status, 400);
});

test("/auth/resend-verification: не палит, существует ли email — одинаковый ответ для существующего неподтверждённого и незарегистрированного", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const existing = await resendVerification({ email });
    const unknown = await resendVerification({ email: testEmail() });
    assert.equal(existing.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(existing.json.data.message, unknown.json.data.message);
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/login: неверный пароль — 400 с тем же сообщением, что и для несуществующего email (не палит, какой email зарегистрирован)", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const wrongPassword = await login({ email, password: "неверный-пароль" });
    const noSuchUser = await login({ email: testEmail(), password: "что-угодно" });

    assert.equal(wrongPassword.status, 400);
    assert.equal(noSuchUser.status, 400);
    assert.equal(wrongPassword.json.error.message, noSuchUser.json.error.message);
    assert.match(wrongPassword.json.error.message, /Неверный email или пароль/);
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/login: пароль хранится хэшированным — прямой SQL-select не содержит пароль в открытом виде", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const { rows } = await pool.query("select encrypted_password from auth.users where id = $1", [su.json.data.user.id]);
    assert.notEqual(rows[0].encrypted_password, "testpass123");
    assert.match(rows[0].encrypted_password, /^\$2[aby]\$/); // bcrypt-формат
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/verify-email: повторный клик по уже сработавшей ссылке — 400 с кодом ALREADY_CONFIRMED (а не общая ошибка)", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const token = await createActionToken(su.json.data.user.id, "verify_email");
    const first = await verifyEmail({ token });
    const second = await verifyEmail({ token });
    assert.equal(first.status, 200);
    assert.equal(second.status, 400);
    assert.equal(second.json.error.code, "ALREADY_CONFIRMED");
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/verify-email: токен вытеснен более новым письмом (аккаунт ещё не подтверждён) — TOKEN_INVALID", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
    const oldToken = await createActionToken(su.json.data.user.id, "verify_email");
    await createActionToken(su.json.data.user.id, "verify_email");
    const r = await verifyEmail({ token: oldToken });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "TOKEN_INVALID");
  } finally {
    await deleteTestUser(su.json.data.user.id);
  }
});

test("/auth/signup: email нормализуется (пробелы, регистр), вход и повторная регистрация нечувствительны к регистру", async () => {
  const base = testEmail();
  const r = await signup({ email: `  ${base.toUpperCase()} `, password: "testpass123" });
  try {
    assert.equal(r.status, 200);
    assert.equal(r.json.data.user.email, base);
    await confirmEmail(r.json.data.user.id);
    const l = await login({ email: base.toUpperCase(), password: "testpass123" });
    assert.equal(l.status, 200);
    const dup = await signup({ email: base, password: "testpass123" });
    assert.equal(dup.status, 400);
  } finally {
    await deleteTestUser(r.json.data.user.id);
  }
});

test("/auth/signup: явно некорректный email отклоняется понятной ошибкой", async () => {
  for (const bad of ["   ", "no-at-sign", "a@b", "a b@c.ru"]) {
    const r = await signup({ email: bad, password: "testpass123" });
    assert.equal(r.status, 400, `"${bad}" должен быть отклонён`);
  }
});

test("/auth/signup: новому ученику автоматически подключаются русский и математика (база) — регресс 0027", async () => {
  const email = testEmail();
  const r = await signup({ email, password: "testpass123", age: 16, gender: "f" });
  try {
    const { rows } = await pool.query("select subject from public.profile_subjects where user_id = $1 order by subject", [r.json.data.user.id]);
    assert.deepEqual(rows.map((x) => x.subject), ["math_base", "rus"]);
    const p = await pool.query("select age, gender from public.profiles where id = $1", [r.json.data.user.id]);
    assert.equal(p.rows[0].age, 16);
    assert.equal(p.rows[0].gender, "f");
  } finally {
    await deleteTestUser(r.json.data.user.id);
  }
});
