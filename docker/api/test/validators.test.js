// Проверка формата email (docker/api/validators.js): только латиница, цифры и обычные спецсимволы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_RE, emailProblem, normalizeEmail } from "../validators.js";

test("EMAIL_RE: обычные адреса принимаются", () => {
  for (const ok of ["ivan@mail.ru", "i.v.an+tag@sub.example.co", "Ivan_Petrov-1990@mail.ru", "o'brien@example.com", "anya@xn--80aswg.xn--p1ai", "t-0f3a@tariffgate-test.local"]) {
    assert.ok(EMAIL_RE.test(ok), ok);
  }
});

test("EMAIL_RE: кириллица и юникод в любой части адреса — отказ (в т.ч. похожие на латиницу буквы)", () => {
  for (const bad of ["л@gmail.com", "иван@mail.ru", "ivan@почта.рф", "ivan@mail.рф", "ivan@gmаil.com" /* кириллическая «а» */, "ivan@gmail.соm" /* кириллические «с», «о» */, "iván@mail.com", "ivan@mail.com​", "ivan @mail.com"]) {
    assert.ok(!EMAIL_RE.test(bad), bad);
  }
});

test("EMAIL_RE: структура — точки, дефисы, длина, зона", () => {
  for (const bad of ["", "no-at-sign", "a@b", "a b@c.ru", "a@b@c.ru", ".ivan@mail.ru", "ivan.@mail.ru", "iv..an@mail.ru", "ivan@-mail.ru", "ivan@mail-.ru", "ivan@mail..ru", "ivan@mail.r", "ivan@mail.123", "ivan@.ru", "@mail.ru", `${"a".repeat(65)}@mail.ru`, `ivan@${"a".repeat(64)}.ru`]) {
    assert.ok(!EMAIL_RE.test(bad), JSON.stringify(bad));
  }
});

test("normalizeEmail: пробелы и регистр убираются, кириллица остаётся кириллицей (её отсекает EMAIL_RE)", () => {
  assert.equal(normalizeEmail("  Ivan@Mail.RU "), "ivan@mail.ru");
  assert.ok(!EMAIL_RE.test(normalizeEmail(" Л@Gmail.com ")));
});

test("emailProblem: null для верного адреса, подсказка про латиницу для кириллицы, общая — для остального", () => {
  assert.equal(emailProblem("ivan@mail.ru"), null);
  assert.match(emailProblem("л@gmail.com"), /латиницей/);
  assert.match(emailProblem("ivan@mail"), /опечатка/);
});
