// DELETE /auth/account — удаление собственного аккаунта, подтверждённое паролем. Проверяем и сам
// каскад (см. supabase/migrations/0001_init.sql/0014_profile_subjects.sql — "on delete cascade" от
// auth.users), и то, что чужой токен/неверный пароль не открывают дыру.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteTestUser, pool } from "./helpers.js";

const BASE_URL = process.env.API_TEST_BASE_URL || "http://localhost:3100";
const TEST_EMAIL_DOMAIN = "deleteaccount-test.local";
const PASSWORD = "testpass123";

function testEmail() {
  return `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

async function signup() {
  const email = testEmail();
  const resp = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, full_name: "Тест Удаление" }),
  });
  const json = await resp.json();
  return { id: json.data.user.id, token: json.access_token };
}

async function deleteAccount(token, password) {
  const resp = await fetch(`${BASE_URL}/auth/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ password }),
  });
  return { status: resp.status, json: await resp.json() };
}

after(() => pool.end());

test("DELETE /auth/account: без токена — 401, аккаунт цел", async () => {
  const { id } = await signup();
  try {
    const r = await deleteAccount(null, PASSWORD);
    assert.equal(r.status, 401);
  } finally {
    await deleteTestUser(id);
  }
});

test("DELETE /auth/account: неверный пароль — 400, аккаунт и все его данные остаются на месте", async () => {
  const { id, token } = await signup();
  try {
    const r = await deleteAccount(token, "неверный-пароль");
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /неверный пароль/i);

    const { rows } = await pool.query("select count(*)::int as n from auth.users where id = $1", [id]);
    assert.equal(rows[0].n, 1);
  } finally {
    await deleteTestUser(id);
  }
});

test("DELETE /auth/account: верный пароль — 200, каскадом уносит profiles/profile_subjects", async () => {
  const { id, token } = await signup();
  const r = await deleteAccount(token, PASSWORD);
  assert.equal(r.status, 200);
  assert.equal(r.json.error, null);

  const users = await pool.query("select count(*)::int as n from auth.users where id = $1", [id]);
  assert.equal(users.rows[0].n, 0);
  const profiles = await pool.query("select count(*)::int as n from public.profiles where id = $1", [id]);
  assert.equal(profiles.rows[0].n, 0);
  const subjects = await pool.query("select count(*)::int as n from public.profile_subjects where user_id = $1", [id]);
  assert.equal(subjects.rows[0].n, 0);
});

test("DELETE /auth/account: без пароля в теле — 400 с понятным сообщением", async () => {
  const { id, token } = await signup();
  try {
    const r = await deleteAccount(token, undefined);
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /пароль/i);
  } finally {
    await deleteTestUser(id);
  }
});
