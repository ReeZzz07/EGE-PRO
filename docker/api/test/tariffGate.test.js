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
import { checkDailyAiLimit, countTodayTutorMessages, isEssayCheckAllowed, releaseDailyAiSlot, reserveDailyAiSlot, resolveUserTariffGate } from "../tariffGate.js";
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

test("reserveDailyAiSlot: под лимитом — резервирует строку и не ограничивает", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    const gate = await resolveUserTariffGate(userId);
    const result = await reserveDailyAiSlot(gate, userId, { taskId: "t1", mode: "chat", content: "привет" });
    assert.equal(result.limited, false);
    assert.equal(await countTodayTutorMessages(userId), 1);
  } finally {
    await deleteTestUser(userId);
  }
});

test("reserveDailyAiSlot: на лимите — не резервирует (не пишет строку)", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    for (let i = 0; i < 3; i++) await insertAiMessage(userId, { mode: "chat", role: "user" });
    const gate = await resolveUserTariffGate(userId);
    const result = await reserveDailyAiSlot(gate, userId, { taskId: "t1", mode: "chat", content: "привет" });
    assert.equal(result.limited, true);
    assert.equal(await countTodayTutorMessages(userId), 3);
  } finally {
    await deleteTestUser(userId);
  }
});

// Тот самый TOCTOU-баг: раньше проверка (SELECT count) и запись строки были разнесены по разные
// стороны медленного вызова модели, ничем не сериализуясь — несколько параллельных запросов от
// одного пользователя читали один и тот же "старый" count и все проходили проверку разом. Здесь
// прямая проверка на конкурентных вызовах ОДНОЙ и той же функции: из 5 параллельных запросов при
// 1 оставшемся слоте должен пройти ровно 1, а не все 5.
test("reserveDailyAiSlot: конкурентные запросы у одного пользователя не превышают лимит", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    await insertAiMessage(userId, { mode: "chat", role: "user" });
    await insertAiMessage(userId, { mode: "chat", role: "user" }); // used=2, остался 1 слот
    const gate = await resolveUserTariffGate(userId);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => reserveDailyAiSlot(gate, userId, { taskId: "t1", mode: "chat", content: `попытка ${i}` }))
    );

    const allowed = results.filter((r) => !r.limited).length;
    assert.equal(allowed, 1, "ровно один конкурентный запрос должен пройти проверку");
    assert.equal(await countTodayTutorMessages(userId), 3, "итоговый счётчик не должен превысить дневной лимит");
  } finally {
    await deleteTestUser(userId);
  }
});

// Резервация происходит ДО обращения к модели (см. server.js) — если сам вызов модели не удался
// (сеть/таймаут/ошибка провайдера), server.js откатывает резервацию через releaseDailyAiSlot,
// чтобы неудачная попытка не стоила ученику одной из его ограниченных попыток на день.
test("releaseDailyAiSlot: откатывает резервацию — счётчик возвращается к прежнему значению", async () => {
  const userId = await createTestUser(); // free, daily_ai_limit=3
  try {
    const gate = await resolveUserTariffGate(userId);
    const reserved = await reserveDailyAiSlot(gate, userId, { taskId: "t1", mode: "chat", content: "привет" });
    assert.equal(reserved.limited, false);
    assert.equal(await countTodayTutorMessages(userId), 1);

    await releaseDailyAiSlot(reserved.reservationId);
    assert.equal(await countTodayTutorMessages(userId), 0, "неудачная попытка не должна тратить дневной лимит");
  } finally {
    await deleteTestUser(userId);
  }
});

test("releaseDailyAiSlot: reservationId отсутствует (админ/безлимит) — ничего не делает, не падает", async () => {
  await assert.doesNotReject(() => releaseDailyAiSlot(undefined));
  await assert.doesNotReject(() => releaseDailyAiSlot(null));
});

test("isEssayCheckAllowed: платный тариф или админ — да, бесплатный обычный пользователь — нет", () => {
  assert.equal(isEssayCheckAllowed({ isAdmin: false, priceRub: 0 }), false);
  assert.equal(isEssayCheckAllowed({ isAdmin: false, priceRub: 1990 }), true);
  assert.equal(isEssayCheckAllowed({ isAdmin: true, priceRub: 0 }), true);
});
