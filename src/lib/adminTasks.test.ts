// loadTaskSubjectStats — сводка "предмет → всего/опубликовано/на проверке" для админки импорта.
// Запрашивается ПО ОДНОМУ предмету за раз намеренно (см. комментарий в исходнике: общий запрос
// на ~58 тыс. строк упирается в потолок PGRST_DB_MAX_ROWS=20000 и даёт заниженные цифры) —
// поэтому важно, что предметы без единого задания просто не попадают в сводку, а не показываются
// нулями вперемешку с реальными данными.
import { describe, expect, it, vi } from "vitest";
import { loadTaskSubjectStats } from "./adminTasks";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), storage: { from: vi.fn() } } }));

function mockRowsFor(bySubject: Record<string, { published: boolean }[]>) {
  return vi.fn((table: string) => {
    if (table !== "tasks") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: (_col: string, subject: string) => Promise.resolve({ data: bySubject[subject] ?? [], error: null }),
      }),
    };
  });
}

describe("loadTaskSubjectStats", () => {
  it("предметы без единого задания не попадают в сводку вовсе", async () => {
    vi.mocked(supabase!.from).mockImplementation(mockRowsFor({ math: [{ published: true }] }) as never);
    const stats = await loadTaskSubjectStats();
    expect(stats).toEqual([{ subject: "math", total: 1, published: 1, needsReview: 0 }]);
  });

  it("считает published/needsReview раздельно по каждому предмету", async () => {
    vi.mocked(supabase!.from).mockImplementation(
      mockRowsFor({
        rus: [{ published: true }, { published: true }, { published: false }],
      }) as never
    );
    const stats = await loadTaskSubjectStats();
    expect(stats).toEqual([{ subject: "rus", total: 3, published: 2, needsReview: 1 }]);
  });

  it("результат отсортирован по коду предмета", async () => {
    vi.mocked(supabase!.from).mockImplementation(mockRowsFor({ rus: [{ published: true }], math: [{ published: true }], bio: [{ published: true }] }) as never);
    const stats = await loadTaskSubjectStats();
    expect(stats.map((s) => s.subject)).toEqual(["bio", "math", "rus"]);
  });

  it("ничего нигде не импортировано — пустая сводка, не исключение", async () => {
    vi.mocked(supabase!.from).mockImplementation(mockRowsFor({}) as never);
    expect(await loadTaskSubjectStats()).toEqual([]);
  });
});
