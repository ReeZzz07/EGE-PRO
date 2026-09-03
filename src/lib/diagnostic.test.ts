// Подбор заданий и подсчёт результата диагностики — определяет и что покажет ученику первым
// экраном после регистрации, и на какие темы укажет план подготовки (weakTopics).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEVEL_LABEL, pickDiagnosticTasks, scoreDiagnostic, type DiagnosticAnswer } from "./diagnostic";
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

afterEach(() => {
  TASKS.length = 0;
});

describe("pickDiagnosticTasks", () => {
  it("исключает задания с развёрнутым ответом (сочинения) — только автопроверяемые", () => {
    TASKS.push(
      task({ id: "s1", subject: "rus" }),
      task({ id: "s2", subject: "rus" }),
      task({ id: "essay1", subject: "rus", answerType: "essay" })
    );
    const picked = pickDiagnosticTasks("rus", 10);
    expect(picked.every((t) => t.answerType !== "essay")).toBe(true);
    expect(picked.map((t) => t.id).sort()).toEqual(["s1", "s2"]);
  });

  it("пул меньше или равен запрошенному количеству — отдаёт всё как есть", () => {
    TASKS.push(task({ id: "a" }), task({ id: "b" }), task({ id: "c" }));
    expect(pickDiagnosticTasks("rus", 10)).toHaveLength(3);
  });

  it("пул больше запрошенного — ровно count заданий, без повторов", () => {
    for (let i = 0; i < 30; i++) TASKS.push(task({ id: `t${i}`, difficulty: ((i % 3) + 1) as 1 | 2 | 3 }));
    const picked = pickDiagnosticTasks("rus", 10);
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((t) => t.id)).size).toBe(10);
  });

  it("другой предмет в пуле не подмешивается", () => {
    TASKS.push(task({ id: "r1", subject: "rus" }), task({ id: "m1", subject: "math" }));
    expect(pickDiagnosticTasks("rus", 10).map((t) => t.id)).toEqual(["r1"]);
  });
});

describe("scoreDiagnostic", () => {
  const mk = (taskId: string, correct: boolean): DiagnosticAnswer => ({ taskId, given: correct ? "1" : "x", correct, skipped: false });

  it("уровень: <40% low, 40–75% mid, ≥75% high", () => {
    TASKS.push(task({ id: "a" }), task({ id: "b" }), task({ id: "c" }), task({ id: "d" }), task({ id: "e" }));
    expect(scoreDiagnostic("rus", [mk("a", false), mk("b", false), mk("c", false), mk("d", false), mk("e", true)]).level).toBe("low"); // 20%
    expect(scoreDiagnostic("rus", [mk("a", true), mk("b", true), mk("c", false), mk("d", false), mk("e", false)]).level).toBe("mid"); // 40%
    expect(scoreDiagnostic("rus", [mk("a", true), mk("b", true), mk("c", true), mk("d", true), mk("e", false)]).level).toBe("high"); // 80%
  });

  it("нет ответов вообще — 0%, low, не деление на ноль", () => {
    const res = scoreDiagnostic("rus", []);
    expect(res.level).toBe("low");
    expect(res.correctCount).toBe(0);
    expect(res.totalCount).toBe(0);
  });

  it("слабые темы (<50% верных) и сильные (100% верных) считаются по topic конкретных заданий", () => {
    TASKS.push(
      task({ id: "w1", topic: "Слабая" }),
      task({ id: "w2", topic: "Слабая" }),
      task({ id: "s1", topic: "Сильная" }),
      task({ id: "s2", topic: "Сильная" })
    );
    const res = scoreDiagnostic("rus", [mk("w1", false), mk("w2", true) /* 50% — НЕ < 50%, не слабая */, mk("s1", true), mk("s2", true)]);
    expect(res.strongTopics).toEqual(["Сильная"]);
    expect(res.weakTopics).toEqual([]); // ровно 50% — не считается слабой (порог строгий <0.5)
  });

  it("тема с явным большинством неверных ответов — слабая", () => {
    TASKS.push(task({ id: "w1", topic: "Слабая" }), task({ id: "w2", topic: "Слабая" }), task({ id: "w3", topic: "Слабая" }));
    const res = scoreDiagnostic("rus", [mk("w1", false), mk("w2", false), mk("w3", true)]);
    expect(res.weakTopics).toEqual(["Слабая"]);
  });

  it("оценочный диапазон балла — в границах [0, 100], min ≤ max", () => {
    TASKS.push(task({ id: "a" }));
    for (const correct of [true, false]) {
      const res = scoreDiagnostic("rus", [mk("a", correct)]);
      expect(res.estimatedScoreMin).toBeGreaterThanOrEqual(0);
      expect(res.estimatedScoreMax).toBeLessThanOrEqual(100);
      expect(res.estimatedScoreMin).toBeLessThanOrEqual(res.estimatedScoreMax);
    }
  });

  it("ответ на несуществующее задание (id не найден) не роняет подсчёт, просто не участвует в темах", () => {
    const res = scoreDiagnostic("rus", [mk("ghost-id", true)]);
    expect(res.correctCount).toBe(1);
    expect(res.weakTopics).toEqual([]);
    expect(res.strongTopics).toEqual([]);
  });
});

describe("LEVEL_LABEL", () => {
  it("человекочитаемые подписи для всех трёх уровней", () => {
    expect(LEVEL_LABEL.low).toBeTruthy();
    expect(LEVEL_LABEL.mid).toBeTruthy();
    expect(LEVEL_LABEL.high).toBeTruthy();
  });
});
