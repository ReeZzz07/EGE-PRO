// Тесты серверной логики тарифов и лимитов ИИ-репетитора (docker/api/tariffGate.js) — гоняются
// против настоящего локального Postgres (см. helpers.js), не мока: именно эти функции стоят
// между бесплатным тарифом и оплатой, ошибка в них либо пропускает лишние обращения, либо
// несправедливо блокирует платящих. Запуск: `npm test` из docker/api (или `npm test -w docker/api`
// из корня — см. package.json).
//
// Каждый тест создаёт и удаляет СВОЕГО пользователя локальной переменной (а не общей на файл) —
// node:test по умолчанию гоняет тесты одного файла конкурентно, общая мутируемая переменная между
// тестами даёт гонку (один тест удаляет "своего" пользователя, пока другой ещё пишет ему сообщения).
// По той же причине здесь нет общего sweepLeftoverTestUsers() в before/after: node --test также
// гоняет РАЗНЫЕ файлы теста параллельно (отдельными процессами) — общий sweep по email-домену в
// after() одного файла удалял бы ещё живых тестовых пользователей другого файла. Если после
// упавшего прогона остался мусор — вызови sweepLeftoverTestUsers() из helpers.js вручную.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { checkDailyAiLimit, countTodayTutorMessages, isEssayCheckAllowed, resolveUserTariffGate } from "../tariffGate.js";
import { createTestUser, deleteTestUser, insertAiMessage, pool } from "./helpers.js";

after(() => pool.end());

test("resolveUserTariffGate: свежий пользователь — free, лимит из тарифа", async () => {
  const userId = await createTestUser();
  try {
    const gate = await resolveUserTariffGate(userId);
    assert.deepEqual(gate, { isAdmin: false, priceRub: 0, dailyAiLimit: 3 });
  } finally {
    await deleteTestUser(userId);
  }
});

test("resolveUserTariffGate: админ на free — isAdmin=true независимо от тарифа", async () => {
  const userId = await createTestUser({ isAdmin: true, tariffId: "free" });
  try {
    const gate = await resolveUserTariffGate(userId);
    assert.equal(gate.isAdmin, true);
  } finally {
    await deleteTestUser(userId);
  }
});

test("resolveUserTariffGate: платный тариф — priceRub>0, dailyAiLimit=null (безлимит)", async () => {
  const userId = await createTestUser({ tariffId: "attestat" });
  try {
    const gate = await resolveUserTariffGate(userId);
    assert.equal(gate.isAdmin, false);
    assert.equal(gate.priceRub, 1990);
    assert.equal(gate.dailyAiLimit, null);
  } finally {
    await deleteTestUser(userId);
  }
});

test("resolveUserTariffGate: несуществующий пользователь — безопасный дефолт, не безлимит", async () => {
  const gate = await resolveUserTariffGate("00000000-0000-0000-0000-000000000000");
  assert.deepEqual(gate, { isAdmin: false, priceRub: 0, dailyAiLimit: null });
});

test("countTodayTutorMessages: считает только role=user и разрешённые режимы за сегодня", async () => {
  const userId = await createTestUser();
  try {
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000);
    await insertAiMessage(userId, { mode: "hint", role: "user" });
    await insertAiMessage(userId, { mode: "explain_topic", role: "user" });
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    await insertAiMessage(userId, { mode: "hint", role: "assistant" }); // ответ ИИ — не в счёт
    await insertAiMessage(userId, { mode: "check_essay", role: "user" }); // у него свой гейт, не в счёт
    await insertAiMessage(userId, { mode: "hint", role: "user", createdAt: yesterday }); // не сегодня

    const n = await countTodayTutorMessages(userId);
    assert.equal(n, 3);
  } finally {
    await deleteTestUser(userId);
  }
});

test("checkDailyAiLimit: админ никогда не ограничен, даже с исчерпанным лимитом", async () => {
  const userId = await createTestUser({ isAdmin: true, tariffId: "free" });
  try {
    for (let i = 0; i < 10; i++) await insertAiMessage(userId, { mode: "chat", role: "user" });
    const gate = await resolveUserTariffGate(userId);
    const result = await checkDailyAiLimit(gate, userId);
    assert.equal(result.limited, false);
  } finally {
    await deleteTestUser(userId);
  }
});

test("checkDailyAiLimit: безлимитный тариф (dailyAiLimit=null) не ограничен", async () => {
  const userId = await createTestUser({ tariffId: "vuz" });
  try {
    for (let i = 0; i < 50; i++) await insertAiMessage(userId, { mode: "chat", role: "user" });
    const gate = await resolveUserTariffGate(userId);
    const result = await checkDailyAiLimit(gate, userId);
    assert.equal(result.limited, false);
  } finally {
    await deleteTestUser(userId);
  }
});

test("checkDailyAiLimit: free — не ограничен, пока меньше лимита", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    const gate = await resolveUserTariffGate(userId);
    const result = await checkDailyAiLimit(gate, userId);
    assert.equal(result.limited, false);
  } finally {
    await deleteTestUser(userId);
  }
});

test("checkDailyAiLimit: free — ограничен ровно по достижении лимита (>=), не только после превышения", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    const gate = await resolveUserTariffGate(userId);
    const result = await checkDailyAiLimit(gate, userId);
    assert.equal(result.limited, true);
  } finally {
    await deleteTestUser(userId);
  }
});

test("isEssayCheckAllowed: платный тариф или админ — да, бесплатный обычный пользователь — нет", () => {
  assert.equal(isEssayCheckAllowed({ isAdmin: false, priceRub: 0 }), false);
  assert.equal(isEssayCheckAllowed({ isAdmin: false, priceRub: 1990 }), true);
  assert.equal(isEssayCheckAllowed({ isAdmin: true, priceRub: 0 }), true);
});
