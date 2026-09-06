// Диагностика/план — источник истины полностью в localStorage, по одному ключу на пользователя и
// предмет (см. комментарий в dbTasks.ts: DB — только зеркало, никогда не читается обратно). Ключ
// обязательно включает userId — без этого на одном браузере диагностика/план предыдущего вошедшего
// аккаунта утекали следующему без выхода из системы (тот же класс бага, что уже чинили для попыток,
// см. lib/store.tsx userAttemptsKey). Здесь — только сами save/load функции;
// mirrorDiagnosticToSupabase/mirrorPlanToSupabase — fire-and-forget запись без ветвлений сверх
// guard isSupabaseConfigured, который уже покрыт в других тестах этой сессии (profileSubjects.test.ts,
// tariffs.test.ts) на том же паттерне.
import { beforeEach, describe, expect, it } from "vitest";
import { loadDiagnosticResult, loadStudyPlan, saveDiagnosticResult, saveStudyPlan } from "./planStorage";
import type { DiagnosticResult } from "./diagnostic";
import type { StudyPlan } from "./plan";

const diagResult: DiagnosticResult = {
  subject: "rus",
  finishedAt: 1700000000000,
  answers: [{ taskId: "t1", given: "1", correct: true, skipped: false }],
  level: "mid",
  correctCount: 1,
  totalCount: 1,
  weakTopics: [],
  strongTopics: ["Тема"],
  estimatedScoreMin: 40,
  estimatedScoreMax: 55,
};

const studyPlan: StudyPlan = {
  subject: "rus",
  generatedAt: 1700000000000,
  today: [{ type: "train", label: "Решить 3 задания", taskIds: ["t1", "t2"] }],
  week: { trainingsPerWeek: 5, mockExams: 1, mistakeReview: false },
  goalText: "Закрепить результат",
};

beforeEach(() => localStorage.clear());

describe("saveDiagnosticResult / loadDiagnosticResult", () => {
  it("ничего не сохранено — null", () => {
    expect(loadDiagnosticResult("rus", "u1")).toBeNull();
  });

  it("round-trip сохраняет структуру без потерь", () => {
    saveDiagnosticResult(diagResult, "u1");
    expect(loadDiagnosticResult("rus", "u1")).toEqual(diagResult);
  });

  it("ключ привязан к предмету — результат по физике не виден для русского", () => {
    saveDiagnosticResult(diagResult, "u1");
    expect(loadDiagnosticResult("fiz", "u1")).toBeNull();
  });

  it("ключ привязан к пользователю — результат одного аккаунта не виден другому на том же браузере", () => {
    saveDiagnosticResult(diagResult, "u1");
    expect(loadDiagnosticResult("rus", "u2")).toBeNull();
  });

  it("битые данные в localStorage — null, не исключение", () => {
    localStorage.setItem("ege-pro.diagnostic.u1.rus.v1", "не json{{{");
    expect(loadDiagnosticResult("rus", "u1")).toBeNull();
  });
});

describe("saveStudyPlan / loadStudyPlan", () => {
  it("round-trip сохраняет структуру без потерь", () => {
    saveStudyPlan(studyPlan, "u1");
    expect(loadStudyPlan("rus", "u1")).toEqual(studyPlan);
  });

  it("ключ привязан к предмету", () => {
    saveStudyPlan(studyPlan, "u1");
    expect(loadStudyPlan("math", "u1")).toBeNull();
  });

  it("ключ привязан к пользователю — план одного аккаунта не виден другому на том же браузере", () => {
    saveStudyPlan(studyPlan, "u1");
    expect(loadStudyPlan("rus", "u2")).toBeNull();
  });

  it("перезапись сохранённого плана по тому же предмету — новые данные вытесняют старые", () => {
    saveStudyPlan(studyPlan, "u1");
    const updated: StudyPlan = { ...studyPlan, goalText: "Другая цель" };
    saveStudyPlan(updated, "u1");
    expect(loadStudyPlan("rus", "u1")?.goalText).toBe("Другая цель");
  });
});
