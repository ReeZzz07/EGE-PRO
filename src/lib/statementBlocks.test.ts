// Таблицы в условиях (26.09.2026: биология «Анализ информации», таблица приходила строками «a | b | c»).
// Схлопнутые списки соответствия (химия и др.) — одна строка «А) … Б) … | 1) … 2) …».
import { describe, expect, it } from "vitest";
import { expandInlineListLine, parseListColumn, parseStatementBlocks } from "./statementBlocks";

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

  it("схлопнутое соответствие А)/1) с « | » → две колонки списков", () => {
    const line =
      "СХЕМА РЕАКЦИИ А) KClO4 → KCl + O2 Б) KClO3 → KCl + KClO4 В) KClO3 → KCl + O2 | ИЗМЕНЕНИЕ СТЕПЕНИ ОКИСЛЕНИЯ ОКИСЛИТЕЛЯ 1) +7 → -1 2) -2 → 0 3) +5 → -1 4) +1 → -1";
    const b = parseStatementBlocks([line]);
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe("match");
    if (b[0].kind !== "match") throw new Error("expected match");
    expect(b[0].left.title).toBe("СХЕМА РЕАКЦИИ");
    expect(b[0].left.items).toEqual([
      "А) KClO4 → KCl + O2",
      "Б) KClO3 → KCl + KClO4",
      "В) KClO3 → KCl + O2",
    ]);
    expect(b[0].right.title).toMatch(/ИЗМЕНЕНИЕ/);
    expect(b[0].right.items).toHaveLength(4);
    expect(b[0].right.items[0]).toBe("1) +7 → -1");
  });

  it("одиночный схлопнутый список 1) 2) 3) без колонок", () => {
    const b = expandInlineListLine("Выберите верные: 1) первое 2) второе 3) третье");
    expect(b[0]).toMatchObject({
      kind: "list",
      title: "Выберите верные:",
      items: ["1) первое", "2) второе", "3) третье"],
    });
  });

  it("parseListColumn не режет «+1 →» внутри пункта", () => {
    expect(parseListColumn("1) +7 → -1 2) -2 → 0").items).toEqual(["1) +7 → -1", "2) -2 → 0"]);
  });
});
