// loadLandingContent — контент лендинга хранится как отдельные строки в content_blocks (одна
// строка на ключ: hero/capabilities/process/faq/ticker), не единым блобом — если админ ещё не
// сохранил какой-то конкретный раздел, для НЕГО должен подставиться дефолт, а не обвалить всю
// страницу или стереть остальные уже сохранённые разделы.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTENT, loadLandingContent } from "./content";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn() } }));

function mockRows(rows: { key: string; data: unknown }[] | null, error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {
    select: () => Promise.resolve({ data: rows, error }),
  };
  return builder;
}

describe("loadLandingContent", () => {
  it("таблица пуста — полный дефолт", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockRows([]) as never);
    expect(await loadLandingContent()).toEqual(DEFAULT_CONTENT);
  });

  it("ошибка запроса — полный дефолт, не исключение", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockRows(null, { message: "boom" }) as never);
    expect(await loadLandingContent()).toEqual(DEFAULT_CONTENT);
  });

  it("сохранён только один раздел (hero) — остальные берутся из дефолта, не пустые", async () => {
    const customHero = { title: "Кастом", highlight: "Кастом", subtitle: "Подзаголовок" };
    vi.mocked(supabase!.from).mockReturnValue(mockRows([{ key: "hero", data: customHero }]) as never);
    const res = await loadLandingContent();
    expect(res.hero).toEqual(customHero);
    expect(res.capabilities).toEqual(DEFAULT_CONTENT.capabilities);
    expect(res.faq).toEqual(DEFAULT_CONTENT.faq);
  });

  it("все разделы сохранены — используются целиком, дефолт не подмешивается", async () => {
    const rows = [
      { key: "hero", data: { title: "H", highlight: "H", subtitle: "S" } },
      { key: "capabilities", data: [] },
      { key: "process", data: [] },
      { key: "faq", data: [] },
      { key: "ticker", data: ["x"] },
    ];
    vi.mocked(supabase!.from).mockReturnValue(mockRows(rows) as never);
    const res = await loadLandingContent();
    expect(res.capabilities).toEqual([]);
    expect(res.ticker).toEqual(["x"]);
  });
});
