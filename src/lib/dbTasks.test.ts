// getAvailableSubjects() — предметы без заданий в банке (сейчас: «Информатика») скрыты из
// онбординга/дашборда/банка заданий (см. App.tsx/Dashboard.tsx/Landing.tsx/OnboardingFlow.tsx/
// TaskBank.tsx). Модуль держит состояние на уровне модуля (subjectAggs/subjectAggsLoaded/TASKS),
// поэтому каждый тест грузит СВОЙ экземпляр через vi.resetModules() + динамический import —
// иначе прогоны тестов заражали бы состояние друг друга (агрегаты грузятся один раз за модуль).
import { beforeEach, describe, expect, it, vi } from "vitest";

const ALL_12_SUBJECTS = ["math", "rus", "inf", "fiz", "soc", "bio", "eng", "geo", "chem", "hist", "lit", "math_base"];

beforeEach(() => {
  vi.resetModules();
});

/** Билдер PostgREST-цепочки .from("tasks").select(...).eq("published",true).eq("subject", s) —
 *  запоминает последний eq("subject", ...) и резолвит им сконфигурированные строки. */
function makeSupabaseMock(rowsBySubject: Record<string, { points: number; bucket: string }[]>) {
  function builder(subject?: string): Record<string, unknown> {
    return {
      select: () => builder(subject),
      eq: (col: string, val: unknown) => builder(col === "subject" ? String(val) : subject),
      then: (resolve: (v: { data: { points: number; bucket: string }[]; error: null }) => void) =>
        resolve({ data: subject ? (rowsBySubject[subject] ?? []) : [], error: null }),
    };
  }
  return { from: vi.fn(() => builder()) };
}

async function loadDbTasks(opts: { configured: boolean; rowsBySubject?: Record<string, { points: number; bucket: string }[]> }) {
  vi.doMock("./supabase", () => ({
    isSupabaseConfigured: opts.configured,
    supabase: opts.configured ? makeSupabaseMock(opts.rowsBySubject ?? {}) : null,
  }));
  return import("./dbTasks");
}

describe("getAvailableSubjects", () => {
  it("гостевой режим (бэкенд не подключён) — все предметы, фильтровать нечем", async () => {
    const { getAvailableSubjects } = await loadDbTasks({ configured: false });
    expect(getAvailableSubjects().sort()).toEqual(ALL_12_SUBJECTS.sort());
  });

  it("бэкенд подключён, но агрегаты ещё не грузились — все предметы (не мигаем пустым списком)", async () => {
    const { getAvailableSubjects } = await loadDbTasks({ configured: true, rowsBySubject: {} });
    expect(getAvailableSubjects().sort()).toEqual(ALL_12_SUBJECTS.sort());
  });

  it("после загрузки агрегатов — предмет с нулём заданий (inf) скрыт, остальные остаются", async () => {
    const rowsBySubject: Record<string, { points: number; bucket: string }[]> = {};
    for (const s of ALL_12_SUBJECTS) rowsBySubject[s] = s === "inf" ? [] : [{ points: 1, bucket: "auto" }];

    const { getAvailableSubjects, loadSubjectAggregates } = await loadDbTasks({ configured: true, rowsBySubject });
    await loadSubjectAggregates();

    const available = getAvailableSubjects();
    expect(available).not.toContain("inf");
    expect(available.sort()).toEqual(ALL_12_SUBJECTS.filter((s) => s !== "inf").sort());
  });

  it("если заданий нет вообще ни по одному предмету — список пуст, а не всё подряд", async () => {
    const rowsBySubject: Record<string, { points: number; bucket: string }[]> = {};
    for (const s of ALL_12_SUBJECTS) rowsBySubject[s] = [];

    const { getAvailableSubjects, loadSubjectAggregates } = await loadDbTasks({ configured: true, rowsBySubject });
    await loadSubjectAggregates();

    expect(getAvailableSubjects()).toEqual([]);
  });
});
