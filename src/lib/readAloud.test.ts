import { describe, expect, it } from "vitest";
import { compareReadAloud, readAloudAccuracy } from "./readAloud";

describe("compareReadAloud", () => {
  it("точное совпадение — все слова помечены прочитанными", () => {
    const result = compareReadAloud("The cat sat on the mat.", "the cat sat on the mat");
    expect(result.every((r) => r.matched)).toBe(true);
    expect(readAloudAccuracy(result)).toBe(1);
  });

  it("регистр и пунктуация расшифровки не мешают совпадению", () => {
    const result = compareReadAloud("Hello, world!", "HELLO WORLD");
    expect(result.map((r) => r.matched)).toEqual([true, true]);
  });

  it("пропущенное слово в расшифровке — соответствующее слово эталона не засчитано", () => {
    const result = compareReadAloud("One two three four", "one three four");
    expect(result.map((r) => ({ word: r.word, matched: r.matched }))).toEqual([
      { word: "One", matched: true },
      { word: "two", matched: false },
      { word: "three", matched: true },
      { word: "four", matched: true },
    ]);
  });

  it("лишнее/шумовое слово в расшифровке не сдвигает совпадение для всех последующих слов", () => {
    const result = compareReadAloud("One two three", "one um two three");
    expect(result.every((r) => r.matched)).toBe(true);
  });

  it("совпадение ищем только вперёд — то же слово раньше в транскрипте не засчитывается повторно", () => {
    // распознано "one two one three" — второе "one" эталона не должно повторно схватить первое "one" транскрипта
    const result = compareReadAloud("one two one three", "one two three");
    expect(result.map((r) => r.matched)).toEqual([true, true, false, true]);
  });

  it("пустая расшифровка — ничего не засчитано, точность 0", () => {
    const result = compareReadAloud("Some words here", "");
    expect(result.every((r) => !r.matched)).toBe(true);
    expect(readAloudAccuracy(result)).toBe(0);
  });

  it("пустой эталон — пустой результат, точность 0 (а не деление на 0)", () => {
    expect(compareReadAloud("", "anything")).toEqual([]);
    expect(readAloudAccuracy([])).toBe(0);
  });

  it("одиночная пунктуация как отдельное 'слово' эталона не в счёт ни за, ни против", () => {
    const result = compareReadAloud("Wait — really?", "wait really");
    expect(result.map((r) => r.matched)).toEqual([true, true, true]);
  });
});
