// "Задание дня" — приоритет: непройденная ошибка > задание по слабой теме из диагностики > любое
// задание предмета (ротация по дню). См. Dashboard.tsx — раньше по всему дашборду было одно
// задание по profile.primarySubject, что могло показать задание по неподключённому предмету при
// рассинхронизации (см. effectivePrimarySubject в lib/auth.tsx).
import { beforeEach, describe, expect, it } from "vitest";
import { pickTaskOfDay } from "./taskOfDay";
import { TASKS, type EgeTask } from "../data/tasks";
import { loadDiagnosticResult, saveDiagnosticResult } from "./planStorage";
import type { DiagnosticResult } from "./diagnostic";

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

function diagResult(over: Partial<DiagnosticResult> & { subject: DiagnosticResult["subject"] }): DiagnosticResult {
  return {
    finishedAt: Date.now(),
    answers: [],
    level: "mid",
    correctCount: 0,
    totalCount: 0,
    weakTopics: [],
    strongTopics: [],
    estimatedScoreMin: 0,
    estimatedScoreMax: 0,
    ...over,
  };
}

beforeEach(() => {
  TASKS.length = 0;
  localStorage.clear();
});

describe("pickTaskOfDay", () => {
  it("есть непройденная ошибка по предмету — берём её, а не что попало", () => {
    TASKS.push(task({ id: "a1", topic: "Тема А" }), task({ id: "a2", topic: "Тема Б" }));
    const task1 = pickTaskOfDay("rus", new Set(["a1"]), new Set(), "u1");
    expect(task1?.id).toBe("a1");
  });

  it("ошибка по ДРУГОМУ предмету не подмешивается", () => {
    TASKS.push(task({ id: "m1", subject: "math", topic: "Тема" }), task({ id: "r1", subject: "rus", topic: "Тема" }));
    const picked = pickTaskOfDay("rus", new Set(["m1"]), new Set(), "u1");
    expect(picked?.id).toBe("r1"); // ошибки по rus нет — падаем на общий пул rus, не на чужой m1
  });

  it("ошибок нет, но есть диагностика со слабой темой — берём непройденное задание по ней", () => {
    TASKS.push(task({ id: "weak1", topic: "Слабая тема" }), task({ id: "strong1", topic: "Сильная тема" }));
    saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
    const picked = pickTaskOfDay("rus", new Set(), new Set(), "u1");
    expect(picked?.id).toBe("weak1");
  });

  it("задание по слабой теме уже решено — берём другое непройденное из той же темы", () => {
    // ровно один незакрытый кандидат в пуле слабой темы (weak1 решено и исключено) — иначе итог
    // зависел бы от dayIndex() и текущей даты, а не от самой проверки "решённое не предлагаем снова"
    TASKS.push(task({ id: "weak1", topic: "Слабая тема" }), task({ id: "weak2", topic: "Слабая тема" }));
    saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
    const picked = pickTaskOfDay("rus", new Set(), new Set(["weak1"]), "u1");
    expect(picked?.id).toBe("weak2");
  });

  it("ни ошибок, ни диагностики — ротация по всему пулу предмета", () => {
    TASKS.push(task({ id: "x1" }));
    const picked = pickTaskOfDay("rus", new Set(), new Set(), "u1");
    expect(picked?.id).toBe("x1");
  });

  it("для предмета нет заданий вовсе — undefined", () => {
    TASKS.push(task({ id: "m1", subject: "math" }));
    expect(pickTaskOfDay("rus", new Set(), new Set(), "u1")).toBeUndefined();
  });

  it("слабая тема сохранена под другим userId — не подмешивается чужому пользователю", () => {
    TASKS.push(task({ id: "weak1", topic: "Слабая тема" }));
    saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
    // задание в банке ровно одно, "по слабой теме" — если бы диагностика u1 утекла в u2, оно всё
    // равно оказалось бы выбрано (единственный кандидат что по приоритету, что по общей ротации);
    // проверяем сам факт изоляции напрямую через хранилище, а не косвенно через результат выбора.
    expect(loadDiagnosticResult("rus", "u2")).toBeNull();
  });
});
