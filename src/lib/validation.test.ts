// исходник серверного валидатора как текст — сверяем регулярку, не импортируя серверный код во фронтенд
import serverValidators from "../../docker/api/validators.js?raw";
import { describe, expect, test } from "vitest";
import { EMAIL_RE, emailProblem, isValidAge, isValidEmail, MAX_AGE, MIN_AGE, MIN_PASSWORD_LENGTH } from "./validation";

describe("isValidEmail", () => {
  test("принимает обычные адреса, в т.ч. с пробелами по краям", () => {
    expect(isValidEmail("ivan@mail.ru")).toBe(true);
    expect(isValidEmail("  ivan@mail.ru  ")).toBe(true);
    expect(isValidEmail("i.v.an+tag@sub.example.co")).toBe(true);
    expect(isValidEmail("Ivan_Petrov-1990@Mail.RU")).toBe(true);
    expect(isValidEmail("o'brien@example.com")).toBe(true);
    expect(isValidEmail("anya@xn--80aswg.xn--p1ai")).toBe(true); // кириллический домен в punycode
  });

  test("кириллица и прочий юникод в адресе не принимаются", () => {
    for (const bad of ["л@gmail.com", "иван@mail.ru", "ivan@почта.рф", "ivan@mail.рф", "ivan@gmail.соm", "ivan@gmаil.com", "iván@mail.com", "ivan@mail.com​"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  test("структура адреса: точки, дефисы, длина, зона", () => {
    for (const bad of [".ivan@mail.ru", "ivan.@mail.ru", "iv..an@mail.ru", "ivan@-mail.ru", "ivan@mail-.ru", "ivan@mail..ru", "ivan@mail.r", "ivan@mail.123", "ivan@.ru", "ivan@mail", "@mail.ru", "ivan@", `${"a".repeat(65)}@mail.ru`, `ivan@${"a".repeat(64)}.ru`, `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(20)}.ru`]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  test("то же правило, что на сервере (docker/api/validators.js) — чтобы фронт и бэк не разъехались", () => {
    const literal = /export const EMAIL_RE =\s*(\/.+\/);/.exec(serverValidators)?.[1];
    expect(literal).toBe(EMAIL_RE.toString());
  });

  test("отклоняет явно некорректные значения", () => {
    for (const bad of ["", "   ", "no-at-sign", "a@b", "a b@c.ru", "a@b@c.ru", "a@b .ru"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe("emailProblem", () => {
  test("верный адрес — без ошибки; опечатка — общая подсказка; кириллица — подсказка про латиницу и раскладку", () => {
    expect(emailProblem(" ivan@mail.ru ")).toBeNull();
    expect(emailProblem("ivan@mail")).toMatch(/опечатка/);
    expect(emailProblem("л@gmail.com")).toMatch(/латиницей/);
    expect(emailProblem("иван@mail.ru")).toMatch(/раскладку/);
  });
});

describe("isValidAge", () => {
  test("принимает целые числа в диапазоне 5..100", () => {
    expect(isValidAge(MIN_AGE)).toBe(true);
    expect(isValidAge(MAX_AGE)).toBe(true);
    expect(isValidAge(17)).toBe(true);
  });

  test("отклоняет за пределами диапазона и нецелые", () => {
    expect(isValidAge(MIN_AGE - 1)).toBe(false);
    expect(isValidAge(MAX_AGE + 1)).toBe(false);
    expect(isValidAge(17.5)).toBe(false);
    expect(isValidAge(NaN)).toBe(false);
  });
});

test("MIN_PASSWORD_LENGTH совпадает с тем, что уже требует бэкенд (docker/api/validators.js)", () => {
  expect(MIN_PASSWORD_LENGTH).toBe(6);
});
