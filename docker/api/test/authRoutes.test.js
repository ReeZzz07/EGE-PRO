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

const BASE_URL = process.env.API_TEST_BASE_URL || "http://localhost:3100";
const TEST_EMAIL_DOMAIN = "authroutes-test.local";

function testEmail() {
  return `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

async function signup(body) {
  const resp = await fetch(`${BASE_URL}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: resp.status, json: await resp.json() };
}

async function login(body) {
  const resp = await fetch(`${BASE_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: resp.status, json: await resp.json() };
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

test("/auth/signup: успех — 200, access_token — валидный JWT с sub=id и правильным email", async () => {
  const email = testEmail();
  const r = await signup({ email, password: "testpass123", full_name: "Тест Тестов" });
  try {
    assert.equal(r.status, 200);
    assert.equal(r.json.error, null);
    assert.equal(r.json.data.user.email, email);
    assert.ok(r.json.data.user.id);

    const payload = jwt.decode(r.json.access_token);
    assert.equal(payload.sub, r.json.data.user.id);
    assert.equal(payload.role, "authenticated");
    assert.equal(payload.email, email);
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

test("/auth/login: верные email+пароль — 200, access_token валиден", async () => {
  const email = testEmail();
  const su = await signup({ email, password: "testpass123" });
  try {
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
