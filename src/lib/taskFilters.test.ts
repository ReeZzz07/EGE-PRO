// Общая логика фильтрации банка заданий — один и тот же список должен получаться и в TaskBank
// (сетка с фильтрами), и в SolveView (переключение previous/next "в пределах текущего фильтра").
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filterTasks, loadTaskBankFilters, saveTaskBankFilters } from "./taskFilters";
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
  TASKS.push(
    task({ id: "t1", subject: "rus", difficulty: 1, topic: "Орфография", statement: ["Вставьте букву"] }),
    task({ id: "t2", subject: "rus", difficulty: 3, topic: "Пунктуация", statement: ["Расставьте запятые"] }),
    task({ id: "t3", subject: "math", difficulty: 2, topic: "Логарифмы", statement: ["Найдите корень"] })
  );
});

afterEach(() => {
  TASKS.length = 0;
});

const emptyDerived = { solvedIds: new Set<string>(), mistakeIds: new Set<string>() };

describe("filterTasks", () => {
  it("без фильтров — все задания", () => {
    expect(filterTasks(DEFAULT_FILTERS, emptyDerived).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("по предмету", () => {
    const res = filterTasks({ ...DEFAULT_FILTERS, subject: "math" }, emptyDerived);
    expect(res.map((t) => t.id)).toEqual(["t3"]);
  });

  it("по сложности (0 — любая, не только «базовая»)", () => {
    expect(filterTasks({ ...DEFAULT_FILTERS, diff: 3 }, emptyDerived).map((t) => t.id)).toEqual(["t2"]);
    expect(filterTasks({ ...DEFAULT_FILTERS, diff: 0 }, emptyDerived)).toHaveLength(3);
  });

  it("по статусу: new/solved/mistake относительно derived-множеств прогресса", () => {
    const derived = { solvedIds: new Set(["t1"]), mistakeIds: new Set(["t2"]) };
    expect(filterTasks({ ...DEFAULT_FILTERS, status: "solved" }, derived).map((t) => t.id)).toEqual(["t1"]);
    expect(filterTasks({ ...DEFAULT_FILTERS, status: "mistake" }, derived).map((t) => t.id)).toEqual(["t2"]);
    // new — ни решено, ни в ошибках
    expect(filterTasks({ ...DEFAULT_FILTERS, status: "new" }, derived).map((t) => t.id)).toEqual(["t3"]);
  });

  it("текстовый поиск — по теме, условию и номеру ФИПИ, регистронезависимо", () => {
    expect(filterTasks({ ...DEFAULT_FILTERS, query: "запят" }, emptyDerived).map((t) => t.id)).toEqual(["t2"]);
    expect(filterTasks({ ...DEFAULT_FILTERS, query: "ЛОГАРИФМ" }, emptyDerived).map((t) => t.id)).toEqual(["t3"]);
    expect(filterTasks({ ...DEFAULT_FILTERS, query: "t1" }, emptyDerived).map((t) => t.id)).toEqual(["t1"]); // по fipiId
  });

  it("фильтры комбинируются (И, не ИЛИ)", () => {
    const res = filterTasks({ subject: "rus", diff: 3, status: "all", query: "" }, emptyDerived);
    expect(res.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("loadTaskBankFilters / saveTaskBankFilters", () => {
  beforeEach(() => localStorage.clear());

  it("ничего не сохранено — дефолтные фильтры", () => {
    expect(loadTaskBankFilters()).toEqual(DEFAULT_FILTERS);
  });

  it("сохранение и загрузка — точный round-trip", () => {
    const filters = { subject: "math" as const, diff: 2 as const, status: "mistake" as const, query: "корень" };
    saveTaskBankFilters(filters);
    expect(loadTaskBankFilters()).toEqual(filters);
  });

  it("частично сохранённые/битые данные в localStorage — недостающие поля берутся из дефолта, не падает", () => {
    localStorage.setItem("ege-pro.taskBankFilters.v1", JSON.stringify({ subject: "geo" }));
    expect(loadTaskBankFilters()).toEqual({ ...DEFAULT_FILTERS, subject: "geo" });

    localStorage.setItem("ege-pro.taskBankFilters.v1", "не json{{{");
    expect(loadTaskBankFilters()).toEqual(DEFAULT_FILTERS);
  });
});
