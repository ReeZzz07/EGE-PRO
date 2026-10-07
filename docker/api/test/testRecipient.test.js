import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTestRecipient } from "../testRecipient.js";

const ADMIN = "admin@ege-tutor.ru";

test("адрес не указан — тест уходит на почту самого админа (как раньше)", () => {
  assert.deepEqual(resolveTestRecipient(undefined, ADMIN), { to: ADMIN });
  assert.deepEqual(resolveTestRecipient("", ADMIN), { to: ADMIN });
  assert.deepEqual(resolveTestRecipient("   ", ADMIN), { to: ADMIN });
  assert.deepEqual(resolveTestRecipient(null, ADMIN), { to: ADMIN });
});

test("произвольный адрес принимается: пробелы по краям и регистр нормализуются", () => {
  assert.deepEqual(resolveTestRecipient("  Tester@Gmail.com ", ADMIN), { to: "tester@gmail.com" });
  assert.deepEqual(resolveTestRecipient("a.b+tag@mail.ru", ADMIN), { to: "a.b+tag@mail.ru" });
});

test("некорректный адрес отклоняется понятным текстом, кириллица — с подсказкой про латиницу; на почту админа молча не подменяется", () => {
  assert.match(resolveTestRecipient("не-почта", ADMIN).error, /латиницей/);
  assert.match(resolveTestRecipient("bad@", ADMIN).error, /Проверь email/);
  assert.match(resolveTestRecipient("two@@gmail.com", ADMIN).error, /Проверь email/);
  assert.equal(resolveTestRecipient("bad", ADMIN).to, undefined);
});
