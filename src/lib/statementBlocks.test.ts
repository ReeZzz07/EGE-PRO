// Таблицы в условиях (26.09.2026: биология «Анализ информации», таблица приходила строками «a | b | c»).
import { describe, expect, it } from "vitest";
import { parseStatementBlocks } from "./statementBlocks";

const BIO = [
  "Проанализируйте таблицу «Содержание соединений». Выберите все утверждения.",
  "Показатель | Содержание на 100 г",
  "Баклажан (плоды) | Томат (плоды) | Картофель (клубни) | Перец болгарский (плоды)",
  "Калий, мг | 238 | 240 | 520 | 190",
  "Кальций, мг | 15 | 10 | 12 | 12",
  "1) Самое высокое содержание витамина C — у болгарского перца.",
];

describe("parseStatementBlocks", () => {
  it("строки с « | » подряд собираются в одну таблицу, остальные остаются абзацами", () => {
    const b = parseStatementBlocks(BIO);
    expect(b.map((x) => x.kind)).toEqual(["text", "table", "text"]);
    const t = b[1];
    if (t.kind !== "table") throw new Error("нет таблицы");
    expect(t.rows).toHaveLength(4);
  });

  it("шапка: заголовок растягивается на оставшиеся колонки, ряд названий колонок получает пустую угловую ячейку", () => {
    const t = parseStatementBlocks(BIO)[1];
    if (t.kind !== "table") throw new Error("нет таблицы");
    const [title, cols, data] = t.rows;
    expect(title.map((c) => [c.text, c.colSpan, c.header])).toEqual([
      ["Показатель", 1, true],
      ["Содержание на 100 г", 4, true],
    ]);
    expect(cols).toHaveLength(5);
    expect(cols[0]).toMatchObject({ text: "", header: true });
    expect(cols[1].text).toBe("Баклажан (плоды)");
    expect(data.map((c) => c.text)).toEqual(["Калий, мг", "238", "240", "520", "190"]);
    expect(data.every((c) => !c.header && c.colSpan === 1)).toBe(true);
  });

  it("таблица из равных рядов (соответствие): первый ряд — шапка, остальные — данные", () => {
    const t = parseStatementBlocks(["ЗАЛИВ | ОБОЗНАЧЕНИЕ", "А) Рижский | 1) A", "Б) Финский | 2) B"])[0];
    if (t.kind !== "table") throw new Error("нет таблицы");
    expect(t.rows.map((r) => r[0].header)).toEqual([true, false, false]);
  });

  it("одиночная строка с « | » таблицей не считается (например, «a | b» — «a делит b»)", () => {
    expect(parseStatementBlocks(["Известно, что 3 | n. Найдите n."])).toEqual([{ kind: "text", text: "Известно, что 3 | n. Найдите n." }]);
  });

  it("без « | » — только абзацы", () => {
    expect(parseStatementBlocks(["раз", "два"]).every((b) => b.kind === "text")).toBe(true);
  });
});
