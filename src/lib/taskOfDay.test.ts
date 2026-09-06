// "Задание дня" — приоритет: тема, подошедшая к сроку интервального повторения (раздел 3.4 ТЗ) >
// непройденная ошибка > задание по слабой теме из диагностики > любое задание предмета (ротация
// по дню). См. Dashboard.tsx — раньше по всему дашборду было одно задание по profile.primarySubject,
// что могло показать задание по неподключённому предмету при рассинхронизации (см.
// effectivePrimarySubject в lib/auth.tsx).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickTaskOfDay } from "./taskOfDay";
import { TASKS, type EgeTask } from "../data/tasks";
import { loadDiagnosticResult, saveDiagnosticResult } from "./planStorage";
import { recordTopicOutcome, REVIEW_INTERVALS_DAYS } from "./spacedReview";
import type { DiagnosticResult } from "./diagnostic";

vi.mock("./supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

const DAY = 86_400_000;

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
  vi.useRealTimers();
});

describe("pickTaskOfDay", () => {
  it("есть непройденная ошибка по предмету — берём её, а не что попало", () => {
    TASKS.push(task({ id: "a1", topic: "Тема А" }), task({ id: "a2", topic: "Тема Б" }));
    const picked = pickTaskOfDay("rus", new Set(["a1"]), new Set(), "u1");
    expect(picked?.task.id).toBe("a1");
    expect(picked?.reason).toBe("mistake");
  });

  it("ошибка по ДРУГОМУ предмету не подмешивается", () => {
    TASKS.push(task({ id: "m1", subject: "math", topic: "Тема" }), task({ id: "r1", subject: "rus", topic: "Тема" }));
    const picked = pickTaskOfDay("rus", new Set(["m1"]), new Set(), "u1");
    expect(picked?.task.id).toBe("r1"); // ошибки по rus нет — падаем на общий пул rus, не на чужой m1
    expect(picked?.reason).toBe("rotation");
  });

  it("ошибок нет, но есть диагностика со слабой темой — берём непройденное задание по ней", () => {
    TASKS.push(task({ id: "weak1", topic: "Слабая тема" }), task({ id: "strong1", topic: "Сильная тема" }));
    saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
    const picked = pickTaskOfDay("rus", new Set(), new Set(), "u1");
    expect(picked?.task.id).toBe("weak1");
    expect(picked?.reason).toBe("weak-topic");
  });

  it("задание по слабой теме уже решено — берём другое непройденное из той же темы", () => {
    // ровно один незакрытый кандидат в пуле слабой темы (weak1 решено и исключено) — иначе итог
    // зависел бы от dayIndex() и текущей даты, а не от самой проверки "решённое не предлагаем снова"
    TASKS.push(task({ id: "weak1", topic: "Слабая тема" }), task({ id: "weak2", topic: "Слабая тема" }));
    saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
    const picked = pickTaskOfDay("rus", new Set(), new Set(["weak1"]), "u1");
    expect(picked?.task.id).toBe("weak2");
  });

  it("ни ошибок, ни диагностики — ротация по всему пулу предмета", () => {
    TASKS.push(task({ id: "x1" }));
    const picked = pickTaskOfDay("rus", new Set(), new Set(), "u1");
    expect(picked?.task.id).toBe("x1");
    expect(picked?.reason).toBe("rotation");
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

  // Раздел 3.4 ТЗ: тема, подошедшая к сроку интервального повторения — самый высокий приоритет,
  // выше даже непройденной ошибки по другой теме и слабой темы из диагностики.
  describe("интервальное повторение (раздел 3.4 ТЗ)", () => {
    it("тема подошла к сроку повторения — берём непройденное задание по ней, а не ошибку/слабую тему", () => {
      TASKS.push(
        task({ id: "review1", topic: "Тема на повторении" }),
        task({ id: "mistake1", topic: "Другая тема" }),
        task({ id: "weak1", topic: "Слабая тема" })
      );
      recordTopicOutcome("u1", "rus", "Тема на повторении", false); // due через 1 день
      saveDiagnosticResult(diagResult({ subject: "rus", weakTopics: ["Слабая тема"] }), "u1");
      vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000); // срок наступил

      const picked = pickTaskOfDay("rus", new Set(["mistake1"]), new Set(), "u1");
      expect(picked?.task.id).toBe("review1");
      expect(picked?.reason).toBe("review");
    });

    it("тема запланирована, но срок ещё не настал — не мешает обычному приоритету (ошибка/слабая тема)", () => {
      TASKS.push(task({ id: "review1", topic: "Тема на повторении" }), task({ id: "mistake1", topic: "Другая тема" }));
      recordTopicOutcome("u1", "rus", "Тема на повторении", false); // due завтра, ещё не сейчас

      const picked = pickTaskOfDay("rus", new Set(["mistake1"]), new Set(), "u1");
      expect(picked?.task.id).toBe("mistake1");
      expect(picked?.reason).toBe("mistake");
    });

    it("по теме на повторении больше нет непройденных заданий — откатывается на следующий приоритет", () => {
      TASKS.push(task({ id: "review1", topic: "Тема на повторении" }), task({ id: "mistake1", topic: "Другая тема" }));
      recordTopicOutcome("u1", "rus", "Тема на повторении", false);
      vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);

      // единственное задание по теме на повторении уже решено — пул пуст
      const picked = pickTaskOfDay("rus", new Set(["mistake1"]), new Set(["review1"]), "u1");
      expect(picked?.task.id).toBe("mistake1");
      expect(picked?.reason).toBe("mistake");
    });
  });
});
