// Тест триггера public.enforce_subject_limit (supabase/migrations/0014_profile_subjects.sql) —
// это единственная настоящая защита лимита предметов по тарифу (RLS insert-политика видит только
// свою строку, посчитать чужие/свои же предметы для лимита она не может, см. комментарий в самой
// миграции). Гоняется тут же, а не только вручную через QA-аккаунт, потому что именно этот триггер
// один раз уже пришлось проверять руками при разработке многопредметности — стоит того, чтобы
// регрессия здесь не проскочила молча.
//
// Нет общего sweepLeftoverTestUsers() в before/after — node --test гоняет разные файлы теста
// параллельно (отдельными процессами); общий sweep по email-домену в after() одного файла удалял
// бы ещё живых тестовых пользователей другого файла (см. tariffGate.test.js). Каждый тест здесь
// сам создаёт и удаляет своего пользователя через try/finally.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

after(() => pool.end());

async function addSubject(userId, subject) {
  await pool.query(`insert into public.profile_subjects (user_id, subject) values ($1, $2)`, [userId, subject]);
}

// createTestUser теперь тоже получает рус+база автоматически (триггер handle_new_user, см.
// supabase/migrations/0015_default_subjects_on_signup.sql) — этот файл проверяет сам триггер
// лимита в изоляции, со своим собственным контролируемым набором предметов, поэтому сбрасываем
// автоподключённые перед каждым сценарием.
async function resetSubjects(userId) {
  await pool.query(`delete from public.profile_subjects where user_id = $1`, [userId]);
}

test("enforce_subject_limit: free (лимит 2) — третий предмет отклоняется", async () => {
  const userId = await createTestUser({ tariffId: "free" });
  try {
    await resetSubjects(userId);
    await addSubject(userId, "math");
    await addSubject(userId, "rus");
    await assert.rejects(() => addSubject(userId, "fiz"), /лимит предметов/i);
  } finally {
    await deleteTestUser(userId);
  }
});

test("enforce_subject_limit: vuz-plus (лимит 5) — пятый проходит, шестой отклоняется", async () => {
  const userId = await createTestUser({ tariffId: "vuz-plus" });
  try {
    await resetSubjects(userId);
    for (const s of ["math", "rus", "fiz", "chem", "bio"]) await addSubject(userId, s);
    await assert.rejects(() => addSubject(userId, "hist"), /лимит предметов/i);
  } finally {
    await deleteTestUser(userId);
  }
});

test("enforce_subject_limit: админ обходит лимит тарифа полностью", async () => {
  const userId = await createTestUser({ isAdmin: true, tariffId: "free" });
  try {
    await resetSubjects(userId);
    for (const s of ["math", "rus", "fiz", "chem", "bio", "hist"]) await addSubject(userId, s);
    const { rows } = await pool.query(`select count(*)::int as n from public.profile_subjects where user_id = $1`, [userId]);
    assert.equal(rows[0].n, 6);
  } finally {
    await deleteTestUser(userId);
  }
});

test("enforce_subject_limit: один и тот же предмет дважды — конфликт уникальности, не лимита", async () => {
  const userId = await createTestUser({ tariffId: "free" });
  try {
    await resetSubjects(userId);
    await addSubject(userId, "math");
    await assert.rejects(() => addSubject(userId, "math"), /duplicate key|unique/i);
  } finally {
    await deleteTestUser(userId);
  }
});

// Раньше select count(*) в триггере ничем не блокировался — несколько конкурентных insert для
// одного user_id читали один и тот же "старый" count в отдельных транзакциях и все проходили
// проверку разом (см. 0019_fix_subject_limit_race.sql: advisory-лок на user_id это чинит).
test("enforce_subject_limit: конкурентные insert одного пользователя не превышают лимит (гонка)", async () => {
  const userId = await createTestUser({ tariffId: "free" }); // лимит 2
  try {
    await resetSubjects(userId);
    await addSubject(userId, "math"); // used=1, остался 1 слот

    const candidates = ["rus", "fiz", "chem", "bio", "hist"];
    const results = await Promise.allSettled(candidates.map((s) => addSubject(userId, s)));
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    assert.equal(fulfilled, 1, "ровно один конкурентный insert должен пройти проверку лимита");

    const { rows } = await pool.query(`select count(*)::int as n from public.profile_subjects where user_id = $1`, [userId]);
    assert.equal(rows[0].n, 2, "итоговое число предметов не должно превысить лимит тарифа");
  } finally {
    await deleteTestUser(userId);
  }
});
