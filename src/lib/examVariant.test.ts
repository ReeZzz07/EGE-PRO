// Экзамен-режим строит вариант по реальной структуре банка (номера ЕГЭ из импорта ФИПИ), а не по
// первым N заданиям подряд — см. MockExam.tsx. Проверяем: одна позиция = один случайный выбор
// среди заданий с этим номером, и что часть с развёрнутым ответом можно целиком исключить.
import { beforeEach, describe, expect, it } from "vitest";
import { getExamStructure, pickExamVariant } from "./examVariant";
import { TASKS, type EgeTask } from "../data/tasks";

function task(over: Partial<EgeTask> & { id: string }): EgeTask {
  return {
    fipiId: over.id,
    subject: "rus",
    egeNumber: 1,
    topic: "Тема",
    difficulty: 1,
    points: 1,
    statement: ["Условие"],
    answers: ["1"],
    answerNote: "",
    explanation: [],
    hints: ["h1", "h2", "h3"],
    ...over,
  };
}

beforeEach(() => {
  TASKS.length = 0;
});

describe("getExamStructure", () => {
  it("группирует по egeNumber — несколько вариантов одного задания это одна позиция, не несколько", () => {
    TASKS.push(task({ id: "a1", egeNumber: 1, points: 1 }), task({ id: "a2", egeNumber: 1, points: 1 }), task({ id: "b1", egeNumber: 2, points: 2 }));
    const structure = getExamStructure("rus");
    expect(structure).toEqual([
      { egeNumber: 1, points: 1, essay: false },
      { egeNumber: 2, points: 2, essay: false },
    ]);
  });

  it("задание с egeNumber=0 (не размечено) в структуру не попадает", () => {
    TASKS.push(task({ id: "a1", egeNumber: 0 }));
    expect(getExamStructure("rus")).toEqual([]);
  });

  it("позиция считается essay по большинству заданий в ней", () => {
    TASKS.push(
      task({ id: "e1", egeNumber: 27, answerType: "essay", points: 25 }),
      task({ id: "e2", egeNumber: 27, answerType: "essay", points: 25 }),
      task({ id: "e3", egeNumber: 27, points: 25 }) // единичный сбой разметки при импорте
    );
    expect(getExamStructure("rus")).toEqual([{ egeNumber: 27, points: 25, essay: true }]);
  });

  it("другой предмет не подмешивается", () => {
    TASKS.push(task({ id: "m1", subject: "math", egeNumber: 1 }), task({ id: "r1", subject: "rus", egeNumber: 1 }));
    expect(getExamStructure("rus")).toHaveLength(1);
  });
});

describe("pickExamVariant", () => {
  it("по одному заданию на позицию, в порядке возрастания номера", () => {
    TASKS.push(task({ id: "a1", egeNumber: 2 }), task({ id: "b1", egeNumber: 1 }));
    const variant = pickExamVariant("rus", true);
    expect(variant.map((t) => t.egeNumber)).toEqual([1, 2]);
  });

  it("includeEssay=false — часть с развёрнутым ответом исключается целиком", () => {
    TASKS.push(task({ id: "a1", egeNumber: 1 }), task({ id: "e1", egeNumber: 27, answerType: "essay", points: 25 }));
    const withoutEssay = pickExamVariant("rus", false);
    expect(withoutEssay.map((t) => t.id)).toEqual(["a1"]);
    const withEssay = pickExamVariant("rus", true);
    expect(withEssay.map((t) => t.id)).toEqual(["a1", "e1"]);
  });

  it("случайный выбор берётся только из заданий этой же позиции", () => {
    TASKS.push(task({ id: "a1", egeNumber: 1 }), task({ id: "a2", egeNumber: 1 }), task({ id: "b1", egeNumber: 2 }));
    for (let i = 0; i < 20; i++) {
      const variant = pickExamVariant("rus", true);
      expect(variant).toHaveLength(2);
      expect(["a1", "a2"]).toContain(variant[0].id);
      expect(variant[1].id).toBe("b1");
    }
  });
});
