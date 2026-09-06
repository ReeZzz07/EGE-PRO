// GET /storage/:bucket/* — единственный ПУБЛИЧНЫЙ (без authMiddleware, картинки должны открываться
// без входа) роут в этом файле. Раньше safeRelPath() проверял на ".." только относительный путь,
// а сам bucket из URL — вообще никак: строка вида "..%2F..%2Fetc" в :bucket декодируется Express'ом
// в "../../etc" ДО path.join(STORAGE_ROOT, bucket, rel), читая произвольный файл с диска
// контейнера без какой-либо авторизации. Фикс — allow-list из двух реальных бакетов
// (avatars, task-media), которого достаточно и для path-traversal, и для отдельно найденной
// проблемы "бакет не из allow-list" в admin-эндпоинтах ниже.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteTestUser, pool } from "./helpers.js";

const BASE_URL = process.env.API_TEST_BASE_URL || "http://localhost:3100";
const TEST_EMAIL_DOMAIN = "storage-test.local";
const PASSWORD = "testpass123";

function testEmail() {
  return `t-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

async function signup() {
  const email = testEmail();
  const resp = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, full_name: "Тест Storage" }),
  });
  const json = await resp.json();
  return { id: json.data.user.id, email, token: json.access_token };
}

async function makeAdmin(userId) {
  await pool.query("update public.profiles set is_admin = true where id = $1", [userId]);
}

after(() => pool.end());

test("GET /storage/:bucket/* — без токена вообще (публичный роут по замыслу)", async () => {
  const resp = await fetch(`${BASE_URL}/storage/avatars/does-not-exist.png`);
  // сам факт того, что запрос прошёл без Authorization и не получил 401 — часть замысла (картинки
  // должны открываться без входа); реального файла нет — 404, не 200 с телом
  assert.equal(resp.status, 404);
});

test("GET /storage/:bucket/* — закодированный traversal в самом bucket не выходит за пределы STORAGE_ROOT", async () => {
  const payloads = ["..%2F..%2Fetc%2Fpasswd", "..%2F..%2F..%2F..%2Fetc%2Fpasswd", "%2e%2e%2f%2e%2e%2fetc"];
  for (const bucket of payloads) {
    const resp = await fetch(`${BASE_URL}/storage/${bucket}/passwd`);
    assert.notEqual(resp.status, 200, `payload "${bucket}" не должен вернуть 200`);
    assert.equal(resp.status, 400, `payload "${bucket}" должен быть отклонён как неизвестный bucket`);
  }
});

test("GET /storage/:bucket/* — неизвестное (но не вредоносное) имя bucket тоже отклоняется", async () => {
  const resp = await fetch(`${BASE_URL}/storage/random-bucket-name/file.png`);
  assert.equal(resp.status, 400);
});

test("GET /storage/:bucket/* — traversal в относительном пути (не bucket) остаётся внутри бакета, не 200", async () => {
  // path.normalize + срез ведущих "./"/"../" в safeRelPath уже сводят любую "../"-цепочку в
  // относительном пути к ведущей последовательности, которая тут же отрезается — сама по себе
  // "p" не может вывести путь за пределы STORAGE_ROOT/bucket (в отличие от bucket, который раньше
  // никак не проверялся). Здесь просто фиксируем, что это НЕ регрессирует в 200 с чужим файлом.
  const resp = await fetch(`${BASE_URL}/storage/avatars/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(resp.status, 404);
});

test("POST /storage/upload — неизвестный bucket отклоняется даже для админа", async () => {
  const user = await signup();
  try {
    await makeAdmin(user.id);
    const form = new FormData();
    form.append("bucket", "not-a-real-bucket");
    form.append("path", "x.png");
    form.append("file", new Blob([Buffer.from([0])]), "x.png");
    const resp = await fetch(`${BASE_URL}/storage/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${user.token}` },
      body: form,
    });
    assert.equal(resp.status, 400);
  } finally {
    await deleteTestUser(user.id);
  }
});
