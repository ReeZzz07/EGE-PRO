// Список пользователей в админке (docker/api/adminUsers.js → searchUsers): фильтры воронки с инверсией
// («да» и «нет» дают ровно противоположные, непересекающиеся выборки), поиск по id/email/имени, фильтр
// по региону/городу (в т.ч. «не из ...»), сортировка, справочник регионов — против настоящего Postgres.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getUserDetail, getUserFacets, searchUsers, USER_BOOL_FILTERS } from "../adminUsers.js";
import { createTestPayment, createTestUser, deleteTestUser, pool } from "./helpers.js";

const tag = `srch${randomUUID().slice(0, 8)}`;
const ids = [];

async function makeUser(name, opts = {}) {
  const id = await createTestUser();
  ids.push(id);
  await pool.query("update auth.users set email = $2, email_confirmed_at = $3 where id = $1", [id, `${tag}-${name}@example.org`, opts.confirmed === false ? null : new Date()]);
  await pool.query("update public.profiles set full_name = $2, onboarded_at = $3, region = $4, city = $5 where id = $1", [
    id,
    `Тест ${name} ${tag}`,
    opts.onboarded ? new Date() : null,
    opts.region ?? null,
    opts.city ?? null,
  ]);
  if (opts.diagnostic) await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [id]);
  if (opts.attempt) await pool.query("insert into public.attempts (user_id, task_id, given, correct, seconds) values ($1, 't-1', '1', true, 5)", [id]);
  if (opts.ai) await pool.query("insert into public.ai_messages (user_id, mode, role, content) values ($1, 'chat', 'user', 'q')", [id]);
  if (opts.payment) await createTestPayment(id, { status: opts.payment });
  return id;
}

let A, B, C, D;
async function setup() {
  if (A) return;
  // A — прошёл всё и заплатил; B — только подтвердил почту и бросил оплату; C — ничего (почта не подтверждена);
  // D — «дошёл до ИИ» без оплаты, другой регион
  A = await makeUser("alpha", { onboarded: true, diagnostic: true, attempt: true, ai: true, payment: "succeeded", region: "Москва", city: "Москва" });
  B = await makeUser("beta", { payment: "pending", region: "Татарстан", city: "Казань" });
  C = await makeUser("gamma", { confirmed: false });
  D = await makeUser("delta", { onboarded: true, ai: true, region: "Москва", city: "Зеленоград" });
}

after(async () => {
  for (const id of ids) await deleteTestUser(id);
  await pool.end();
});

const found = async (extra = {}) => (await searchUsers({ q: tag, pageSize: 100, ...extra })).rows.map((r) => r.id);
const set = (...xs) => xs.sort();
const eq = (actual, expected) => assert.deepEqual(set(...actual), set(...expected));

test("без фильтров: находятся все четыре тестовых пользователя", async () => {
  await setup();
  eq(await found(), [A, B, C, D]);
});

test("каждый булев фильтр: «да» и «нет» — противоположные непересекающиеся выборки, вместе дающие всех", async () => {
  await setup();
  const all = [A, B, C, D];
  for (const key of USER_BOOL_FILTERS) {
    const yes = await found({ filters: { [key]: "yes" } });
    const no = await found({ filters: { [key]: "no" } });
    assert.equal(yes.filter((x) => no.includes(x)).length, 0, `${key}: выборки пересекаются`);
    eq([...yes, ...no], all);
  }
});

test("фильтры воронки выбирают ожидаемых пользователей", async () => {
  await setup();
  eq(await found({ filters: { confirmed: "no" } }), [C]);
  eq(await found({ filters: { confirmed: "yes" } }), [A, B, D]);
  eq(await found({ filters: { onboarded: "yes" } }), [A, D]);
  eq(await found({ filters: { diagnostic: "yes" } }), [A]);
  eq(await found({ filters: { first_task: "yes" } }), [A]);
  eq(await found({ filters: { ai_request: "yes" } }), [A, D]);
  eq(await found({ filters: { paid: "yes" } }), [A]);
  eq(await found({ filters: { abandoned: "yes" } }), [B]);
});

test("комбинация фильтров работает как И; инверсия внутри комбинации", async () => {
  await setup();
  eq(await found({ filters: { ai_request: "yes", paid: "no" } }), [D]);
  eq(await found({ filters: { confirmed: "yes", onboarded: "no", abandoned: "no" } }), []);
  eq(await found({ filters: { confirmed: "yes", onboarded: "no" } }), [B]);
});

test("«начал, но не завершил оплату»: тот, кто потом заплатил, в выборку не попадает", async () => {
  await setup();
  await createTestPayment(B, { status: "canceled" });
  eq(await found({ filters: { abandoned: "yes" } }), [B]);
  await createTestPayment(B, { status: "succeeded" });
  eq(await found({ filters: { abandoned: "yes" } }), []);
  eq(await found({ filters: { paid: "yes" } }), [A, B]);
});

test("регион и город: точное совпадение без учёта регистра и инверсия «не из…» (включая тех, у кого поле пустое)", async () => {
  await setup();
  eq(await found({ filters: { region: "москва" } }), [A, D]);
  eq(await found({ filters: { region: "Москва", regionNot: true } }), [B, C]);
  eq(await found({ filters: { city: "Казань" } }), [B]);
  eq(await found({ filters: { city: "Казань", cityNot: true } }), [A, C, D]);
  eq(await found({ filters: { region: "Москва", city: "Зеленоград" } }), [D]);
  eq(await found({ filters: { region: "Москва", city: "Москва", cityNot: true } }), [D]);
});

test("поиск: по id (полному и по началу), email и имени; служебные символы LIKE ищутся буквально", async () => {
  await setup();
  const one = async (q) => (await searchUsers({ q, pageSize: 100 })).rows.map((r) => r.id);
  eq(await one(A), [A]);
  eq(await one(A.slice(0, 13)), [A]);
  eq(await one(`${tag}-beta`), [B]);
  eq(await one(`Тест gamma ${tag}`), [C]);
  eq(await one(`ТЕСТ DELTA ${tag.toUpperCase()}`), [D]);
  assert.equal((await one("%")).length, 0, "«%» не должен работать как маска «любой текст»");
  assert.equal((await one("_")).length, 0);
  assert.equal((await searchUsers({ q: `${tag}-alpha`, filters: { paid: "no" } })).total, 0, "поиск и фильтр складываются");
});

test("сортировка по имени в обе стороны, пагинация и общий счётчик", async () => {
  await setup();
  const names = async (dir) => (await searchUsers({ q: tag, sort: "name", dir, pageSize: 100 })).rows.map((r) => r.full_name);
  const n = (x) => `Тест ${x} ${tag}`;
  assert.deepEqual(await names("asc"), [n("alpha"), n("beta"), n("delta"), n("gamma")]);
  assert.deepEqual(await names("desc"), [n("gamma"), n("delta"), n("beta"), n("alpha")]);
  const p0 = await searchUsers({ q: tag, sort: "name", dir: "asc", page: 0, pageSize: 3 });
  const p1 = await searchUsers({ q: tag, sort: "name", dir: "asc", page: 1, pageSize: 3 });
  assert.equal(p0.rows.length, 3);
  assert.equal(p1.rows.length, 1);
  assert.equal(p0.total, 4);
  assert.ok(p0.overall >= 4);
  // неизвестное поле сортировки не ломает запрос (и не открывает SQL-инъекцию через имя колонки)
  await assert.doesNotReject(() => searchUsers({ q: tag, sort: "u.id; drop table x", dir: "desc" }));
});

test("строки списка несут флаги воронки, регион и город", async () => {
  await setup();
  const rows = (await searchUsers({ q: tag, pageSize: 100 })).rows;
  const a = rows.find((r) => r.id === A);
  assert.deepEqual(
    USER_BOOL_FILTERS.map((k) => [k, a[k]]),
    [["confirmed", true], ["onboarded", true], ["diagnostic", true], ["first_task", true], ["ai_request", true], ["paid", true], ["abandoned", false]]
  );
  assert.equal(a.region, "Москва");
  assert.equal(a.city, "Москва");
  assert.equal(rows.find((r) => r.id === C).confirmed, false);
});

test("справочник регионов и городов: значения с количеством пользователей", async () => {
  await setup();
  const f = await getUserFacets();
  const moscow = f.regions.find((r) => r.value === "Москва");
  assert.ok(moscow && moscow.count >= 2);
  assert.ok(f.regions.some((r) => r.value === "Татарстан"));
  assert.ok(f.cities.some((c) => c.value === "Казань" && c.region === "Татарстан"));
});

test("карточка пользователя: сводка активности и платежи", async () => {
  await setup();
  const d = await getUserDetail(A);
  assert.equal(d.activity.attempts.count, 1);
  assert.equal(d.activity.diagnostics.count, 1);
  assert.equal(d.activity.ai.count, 1);
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].status, "succeeded");
  const empty = await getUserDetail(C);
  assert.equal(empty.activity.attempts.count, 0);
  assert.equal(empty.payments.length, 0);
});
