import { describe, expect, test } from "vitest";
import { isValidAge, isValidEmail, MAX_AGE, MIN_AGE, MIN_PASSWORD_LENGTH } from "./validation";

describe("isValidEmail", () => {
  test("принимает обычные адреса, в т.ч. с пробелами по краям", () => {
    expect(isValidEmail("ivan@mail.ru")).toBe(true);
    expect(isValidEmail("  ivan@mail.ru  ")).toBe(true);
    expect(isValidEmail("i.v.an+tag@sub.example.co")).toBe(true);
  });

  test("отклоняет явно некорректные значения", () => {
    for (const bad of ["", "   ", "no-at-sign", "a@b", "a b@c.ru", "a@b@c.ru", "a@b .ru"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
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
