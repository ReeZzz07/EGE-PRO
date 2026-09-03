// Диагностика/план — источник истины полностью в localStorage, по одному ключу на предмет (см.
// комментарий в dbTasks.ts: DB — только зеркало, никогда не читается обратно). Здесь — только
// сами save/load функции; mirrorDiagnosticToSupabase/mirrorPlanToSupabase — fire-and-forget запись
// без ветвлений сверх guard isSupabaseConfigured, который уже покрыт в других тестах этой сессии
// (profileSubjects.test.ts, tariffs.test.ts) на том же паттерне.
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
    expect(loadDiagnosticResult("rus")).toBeNull();
  });

  it("round-trip сохраняет структуру без потерь", () => {
    saveDiagnosticResult(diagResult);
    expect(loadDiagnosticResult("rus")).toEqual(diagResult);
  });

  it("ключ привязан к предмету — результат по физике не виден для русского", () => {
    saveDiagnosticResult(diagResult);
    expect(loadDiagnosticResult("fiz")).toBeNull();
  });

  it("битые данные в localStorage — null, не исключение", () => {
    localStorage.setItem("ege-pro.diagnostic.rus.v1", "не json{{{");
    expect(loadDiagnosticResult("rus")).toBeNull();
  });
});

describe("saveStudyPlan / loadStudyPlan", () => {
  it("round-trip сохраняет структуру без потерь", () => {
    saveStudyPlan(studyPlan);
    expect(loadStudyPlan("rus")).toEqual(studyPlan);
  });

  it("ключ привязан к предмету", () => {
    saveStudyPlan(studyPlan);
    expect(loadStudyPlan("math")).toBeNull();
  });

  it("перезапись сохранённого плана по тому же предмету — новые данные вытесняют старые", () => {
    saveStudyPlan(studyPlan);
    const updated: StudyPlan = { ...studyPlan, goalText: "Другая цель" };
    saveStudyPlan(updated);
    expect(loadStudyPlan("rus")?.goalText).toBe("Другая цель");
  });
});
