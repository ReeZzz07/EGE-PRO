// Тесты одноразовых токенов подтверждения email / сброса пароля (docker/api/authTokens.js) —
// гоняются против настоящего локального Postgres (см. helpers.js), не мока. Отправка письма
// (mailer.js) здесь не тестируется — createActionToken/consumeActionToken работают только с
// auth.action_tokens и не знают про почту вообще.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createActionToken, consumeActionToken } from "../authTokens.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

after(() => pool.end());

test("createActionToken → consumeActionToken: валидный токен возвращает userId", async () => {
  const userId = await createTestUser();
  try {
    const token = await createActionToken(userId, "verify_email");
    const result = await consumeActionToken(token, "verify_email");
    assert.equal(result, userId);
  } finally {
    await deleteTestUser(userId);
  }
});

test("consumeActionToken: неизвестный токен — null, не падает", async () => {
  const result = await consumeActionToken("not-a-real-token", "verify_email");
  assert.equal(result, null);
});

test("consumeActionToken: токен нельзя использовать дважды", async () => {
  const userId = await createTestUser();
  try {
    const token = await createActionToken(userId, "reset_password");
    const first = await consumeActionToken(token, "reset_password");
    const second = await consumeActionToken(token, "reset_password");
    assert.equal(first, userId);
    assert.equal(second, null, "повторное использование того же токена должно быть отклонено");
  } finally {
    await deleteTestUser(userId);
  }
});

test("consumeActionToken: неверный purpose для существующего токена — null", async () => {
  const userId = await createTestUser();
  try {
    const token = await createActionToken(userId, "verify_email");
    const result = await consumeActionToken(token, "reset_password");
    assert.equal(result, null, "токен для одной цели не должен подходить для другой");
  } finally {
    await deleteTestUser(userId);
  }
});

test("consumeActionToken: истёкший токен отклоняется", async () => {
  const userId = await createTestUser();
  try {
    const token = await createActionToken(userId, "reset_password");
    // искусственно состариваем токен, не дожидаясь реального часа TTL
    await pool.query("update auth.action_tokens set expires_at = now() - interval '1 minute' where user_id = $1", [userId]);
    const result = await consumeActionToken(token, "reset_password");
    assert.equal(result, null);
  } finally {
    await deleteTestUser(userId);
  }
});

test("createActionToken: новый токен гасит прежние неиспользованные того же назначения", async () => {
  const userId = await createTestUser();
  try {
    const first = await createActionToken(userId, "reset_password");
    const second = await createActionToken(userId, "reset_password");
    const firstResult = await consumeActionToken(first, "reset_password");
    const secondResult = await consumeActionToken(second, "reset_password");
    assert.equal(firstResult, null, "старый токен должен быть погашен новым запросом");
    assert.equal(secondResult, userId, "новый токен должен работать");
  } finally {
    await deleteTestUser(userId);
  }
});

test("createActionToken: разные назначения не мешают друг другу (оба остаются рабочими)", async () => {
  const userId = await createTestUser();
  try {
    const verifyToken = await createActionToken(userId, "verify_email");
    const resetToken = await createActionToken(userId, "reset_password");
    assert.equal(await consumeActionToken(verifyToken, "verify_email"), userId);
    assert.equal(await consumeActionToken(resetToken, "reset_password"), userId);
  } finally {
    await deleteTestUser(userId);
  }
});

test("consumeActionToken: конкурентные попытки использовать один и тот же токен — проходит ровно одна", async () => {
  const userId = await createTestUser();
  try {
    const token = await createActionToken(userId, "reset_password");
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeActionToken(token, "reset_password")));
    const succeeded = results.filter((r) => r === userId).length;
    assert.equal(succeeded, 1, "ровно одна конкурентная попытка должна пройти");
  } finally {
    await deleteTestUser(userId);
  }
});
