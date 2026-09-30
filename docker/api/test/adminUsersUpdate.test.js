// Правка пользователя из админки (docker/api/adminUsers.js → updateUser), в частности email —
// раньше формат тут вообще не проверялся: опечатка при ручной правке молча ломала все будущие
// письма пользователю (включая подтверждение регистрации), без единой ошибки ни админу, ни ему.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { updateUser } from "../adminUsers.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

after(() => pool.end());

test("updateUser: явно некорректный email отклоняется, запись в БД не меняется", async () => {
  const id = await createTestUser();
  try {
    const before = (await pool.query("select email from auth.users where id = $1", [id])).rows[0].email;
    for (const bad of ["   ", "no-at-sign", "a@b", "a b@c.ru"]) {
      const res = await updateUser(id, { email: bad });
      assert.ok(res.error, `"${bad}" должен быть отклонён`);
    }
    const after = (await pool.query("select email from auth.users where id = $1", [id])).rows[0].email;
    assert.equal(after, before);
  } finally {
    await deleteTestUser(id);
  }
});

test("updateUser: валидный email нормализуется (trim + lowercase) и сохраняется", async () => {
  const id = await createTestUser();
  try {
    const res = await updateUser(id, { email: "  Admin-Fixed@Example.COM  " });
    assert.equal(res.error, undefined);
    const { email } = (await pool.query("select email from auth.users where id = $1", [id])).rows[0];
    assert.equal(email, "admin-fixed@example.com");
  } finally {
    await deleteTestUser(id);
  }
});

test("updateUser: email уже занят другим аккаунтом (без учёта регистра) — отклоняется", async () => {
  const a = await createTestUser();
  const b = await createTestUser();
  try {
    await pool.query("update auth.users set email = $2 where id = $1", [a, "taken@example.org"]);
    const res = await updateUser(b, { email: "Taken@Example.org" });
    assert.match(res.error, /уже занят/);
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
  }
});
