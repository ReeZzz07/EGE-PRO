// POST /auth/change-password, POST /auth/change-email, POST+DELETE /profile/avatar — настройки
// профиля, которые может менять сам ученик (без requireAdmin, в отличие от /storage/upload).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { deleteTestUser, pool } from "./helpers.js";

const BASE_URL = process.env.API_TEST_BASE_URL || "http://localhost:3100";
const TEST_EMAIL_DOMAIN = "profilesettings-test.local";
const PASSWORD = "testpass123";

// минимальный валидный PNG 1x1 — для проверки sniffAvatarImageType по магическим байтам,
// а не по расширению/имени файла
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function testEmail() {
  return `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

async function signup() {
  const email = testEmail();
  const resp = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, full_name: "Тест Настройки" }),
  });
  const json = await resp.json();
  return { id: json.data.user.id, email, token: json.access_token };
}

async function changePassword(token, body) {
  const resp = await fetch(`${BASE_URL}/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: resp.status, json: await resp.json() };
}

async function changeEmail(token, body) {
  const resp = await fetch(`${BASE_URL}/auth/change-email`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: resp.status, json: await resp.json() };
}

async function uploadAvatar(token, buffer, filename, contentType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), filename);
  const resp = await fetch(`${BASE_URL}/profile/avatar`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: resp.status, json: await resp.json() };
}

async function deleteAvatar(token) {
  const resp = await fetch(`${BASE_URL}/profile/avatar`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  return { status: resp.status, json: await resp.json() };
}

after(() => pool.end());

test("/auth/change-password: неверный текущий пароль — 400, пароль не меняется", async () => {
  const { id, token } = await signup();
  try {
    const r = await changePassword(token, { currentPassword: "неверный", newPassword: "newpass123" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /неверный текущий пароль/i);
  } finally {
    await deleteTestUser(id);
  }
});

test("/auth/change-password: новый пароль короче 6 символов — 400", async () => {
  const { id, token } = await signup();
  try {
    const r = await changePassword(token, { currentPassword: PASSWORD, newPassword: "abc" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /6 символов/);
  } finally {
    await deleteTestUser(id);
  }
});

test("/auth/change-password: успех — новым паролем можно войти, старым уже нет", async () => {
  const { id, email, token } = await signup();
  try {
    const r = await changePassword(token, { currentPassword: PASSWORD, newPassword: "newpass123" });
    assert.equal(r.status, 200);
    assert.equal(r.json.error, null);

    const loginOld = await fetch(`${BASE_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    assert.equal(loginOld.status, 400);

    const loginNew = await fetch(`${BASE_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "newpass123" }) });
    assert.equal(loginNew.status, 200);
  } finally {
    await deleteTestUser(id);
  }
});

test("/auth/change-email: неверный пароль — 400, email не меняется", async () => {
  const { id, email, token } = await signup();
  try {
    const r = await changeEmail(token, { password: "неверный", newEmail: testEmail() });
    assert.equal(r.status, 400);
    const { rows } = await pool.query("select email from auth.users where id = $1", [id]);
    assert.equal(rows[0].email, email);
  } finally {
    await deleteTestUser(id);
  }
});

test("/auth/change-email: email уже занят другим аккаунтом — 400", async () => {
  const a = await signup();
  const b = await signup();
  try {
    const r = await changeEmail(a.token, { password: PASSWORD, newEmail: b.email });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /занят/i);
  } finally {
    await deleteTestUser(a.id);
    await deleteTestUser(b.id);
  }
});

test("/auth/change-email: успех — 200, свежий токен содержит новый email в payload", async () => {
  const { id, token } = await signup();
  const newEmail = testEmail();
  try {
    const r = await changeEmail(token, { password: PASSWORD, newEmail });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.user.email, newEmail);
    const payload = jwt.decode(r.json.access_token);
    assert.equal(payload.sub, id);
    assert.equal(payload.email, newEmail);
  } finally {
    await deleteTestUser(id);
  }
});

test("POST /profile/avatar: без токена — 401", async () => {
  const r = await uploadAvatar(null, PNG_1X1, "a.png", "image/png");
  assert.equal(r.status, 401);
});

test("POST /profile/avatar: не картинка (текстовый файл под видом .png) — 400, отклоняется по содержимому, не по имени", async () => {
  const { id, token } = await signup();
  try {
    const r = await uploadAvatar(token, Buffer.from("это не картинка"), "avatar.png", "image/png");
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /PNG, JPEG, GIF/);
    const { rows } = await pool.query("select avatar_url from public.profiles where id = $1", [id]);
    assert.equal(rows[0].avatar_url, null);
  } finally {
    await deleteTestUser(id);
  }
});

test("POST /profile/avatar → GET /storage/avatars/... → DELETE /profile/avatar: полный цикл", async () => {
  const { id, token } = await signup();
  try {
    const up = await uploadAvatar(token, PNG_1X1, "avatar.png", "image/png");
    assert.equal(up.status, 200);
    assert.equal(up.json.path, `avatars/${id}.png`);

    const { rows } = await pool.query("select avatar_url from public.profiles where id = $1", [id]);
    assert.equal(rows[0].avatar_url, `avatars/${id}.png`);

    const served = await fetch(`${BASE_URL}/storage/${up.json.path}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");

    const del = await deleteAvatar(token);
    assert.equal(del.status, 200);

    const after1 = await pool.query("select avatar_url from public.profiles where id = $1", [id]);
    assert.equal(after1.rows[0].avatar_url, null);
    const servedAfterDelete = await fetch(`${BASE_URL}/storage/${up.json.path}`);
    assert.equal(servedAfterDelete.status, 404);
  } finally {
    await deleteTestUser(id);
  }
});
