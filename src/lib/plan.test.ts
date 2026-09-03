// generatePlan — эвристический план подготовки по итогам диагностики, без ИИ (см. комментарий
// в исходнике: "раздел 3.2 ТЗ"). От него зависит, что ученик увидит в блоке "план на сегодня"
// на дашборде сразу после диагностики.
import { afterEach, describe, expect, it } from "vitest";
import { generatePlan } from "./plan";
import type { DiagnosticResult } from "./diagnostic";
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

function diagResult(over: Partial<DiagnosticResult>): DiagnosticResult {
  return {
    subject: "rus",
    finishedAt: Date.now(),
    answers: [],
    level: "mid",
    correctCount: 5,
    totalCount: 10,
    weakTopics: [],
    strongTopics: [],
    estimatedScoreMin: 40,
    estimatedScoreMax: 55,
    ...over,
  };
}

afterEach(() => {
  TASKS.length = 0;
});

describe("generatePlan — сегодняшний план", () => {
  it("есть слабая тема с заданиями в банке — «повторить» + «решить N заданий по теме»", () => {
    TASKS.push(task({ id: "t1", topic: "Причастия" }), task({ id: "t2", topic: "Причастия" }), task({ id: "other", topic: "Другое" }));
    const plan = generatePlan(diagResult({ weakTopics: ["Причастия"] }), 20);
    expect(plan.today[0]).toMatchObject({ type: "review-topic", label: 'Повторить тему «Причастия»' });
    expect(plan.today[1]).toMatchObject({ type: "train", taskIds: ["t1", "t2"] });
    expect(plan.today[1].label).toContain("2 задания");
  });

  it("слабая тема есть, но заданий по ней в банке нет — только «повторить», без пункта «решить»", () => {
    const plan = generatePlan(diagResult({ weakTopics: ["Без заданий в банке"] }), 20);
    expect(plan.today).toHaveLength(1);
    expect(plan.today[0].type).toBe("review-topic");
  });

  it("слабых тем нет — общий пункт «закрепить формат», без обращения к конкретной теме", () => {
    TASKS.push(task({ id: "a" }), task({ id: "b" }), task({ id: "c" }), task({ id: "d" }));
    const plan = generatePlan(diagResult({ weakTopics: [] }), 20);
    expect(plan.today).toHaveLength(1);
    expect(plan.today[0].type).toBe("train");
    expect(plan.today[0].taskIds).toHaveLength(3); // максимум 3, даже если в банке больше
  });

  it("сочинения не попадают в общий тренировочный набор при отсутствии слабых тем", () => {
    TASKS.push(task({ id: "short1" }), task({ id: "essay1", answerType: "essay" }));
    const plan = generatePlan(diagResult({ weakTopics: [] }), 20);
    expect(plan.today[0].taskIds).toEqual(["short1"]);
  });
});

describe("generatePlan — недельный ритм по dailyMinutes", () => {
  it("≤10 минут — 3 тренировки в неделю", () => {
    expect(generatePlan(diagResult({}), 10).week.trainingsPerWeek).toBe(3);
  });
  it("11–30 минут — 5 тренировок", () => {
    expect(generatePlan(diagResult({}), 25).week.trainingsPerWeek).toBe(5);
    expect(generatePlan(diagResult({}), 30).week.trainingsPerWeek).toBe(5);
  });
  it(">30 минут — 6 тренировок", () => {
    expect(generatePlan(diagResult({}), 60).week.trainingsPerWeek).toBe(6);
  });
  it("dailyMinutes не задан — дефолт 20 минут (5 тренировок)", () => {
    expect(generatePlan(diagResult({}), undefined).week.trainingsPerWeek).toBe(5);
  });

  it("мини-пробник — всегда ровно 1 в неделю, независимо от прочего", () => {
    expect(generatePlan(diagResult({ weakTopics: [] }), 10).week.mockExams).toBe(1);
    expect(generatePlan(diagResult({ weakTopics: ["A", "B", "C"] }), 60).week.mockExams).toBe(1);
  });

  it("работа над ошибками включена только если есть слабые темы", () => {
    expect(generatePlan(diagResult({ weakTopics: [] }), 20).week.mistakeReview).toBe(false);
    expect(generatePlan(diagResult({ weakTopics: ["A"] }), 20).week.mistakeReview).toBe(true);
  });
});

describe("generatePlan — текст цели", () => {
  it("0 слабых тем — про закрепление и часть 2", () => {
    expect(generatePlan(diagResult({ weakTopics: [] }), 20).goalText).toMatch(/закрепить результат/i);
  });
  it("1–2 слабые темы — перечисляет их прямо", () => {
    expect(generatePlan(diagResult({ weakTopics: ["Причастия"] }), 20).goalText).toBe("Закрыть темы: Причастия.");
    expect(generatePlan(diagResult({ weakTopics: ["А", "Б"] }), 20).goalText).toBe("Закрыть темы: А, Б.");
  });
  it("3+ слабых темы — общая формулировка «постепенно», с первой темой как ориентиром", () => {
    const text = generatePlan(diagResult({ weakTopics: ["А", "Б", "В"] }), 20).goalText;
    expect(text).toMatch(/постепенно закрыть/i);
    expect(text).toContain("«А»");
  });
});
