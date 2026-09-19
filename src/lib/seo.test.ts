// loadSeoSettings — SEO применяется только к двум маркетинговым страницам (главная/тарифы, см.
// комментарий в исходнике: оферта/политика — фиксированные, не про SEO). Ключевая логика тут —
// глубокое слияние с дефолтами постранично и по полям, чтобы частично заполненная админом форма
// не стирала остальные заголовки/описания нулями.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEO, loadSeoSettings } from "./seo";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn() } }));

function mockResult(result: { data?: unknown; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}

describe("loadSeoSettings", () => {
  it("ничего не сохранено в БД — дефолт как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: null }) as never);
    expect(await loadSeoSettings()).toEqual(DEFAULT_SEO);
  });

  it("ошибка запроса — дефолт, а не исключение наверх", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: { message: "boom" } }) as never);
    expect(await loadSeoSettings()).toEqual(DEFAULT_SEO);
  });

  it("частично заполнено (только ogImage) — заголовки/описания страниц остаются дефолтными", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { ogImage: "https://x/img.png" } }, error: null }) as never);
    const res = await loadSeoSettings();
    expect(res.ogImage).toBe("https://x/img.png");
    expect(res.pages).toEqual(DEFAULT_SEO.pages);
  });

  it("частично заполнена одна страница (только title) — description для неё берётся из дефолта, другая страница не тронута", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { pages: { home: { title: "Кастомный заголовок" } } } }, error: null }) as never);
    const res = await loadSeoSettings();
    expect(res.pages.home.title).toBe("Кастомный заголовок");
    expect(res.pages.home.description).toBe(DEFAULT_SEO.pages.home.description);
    expect(res.pages.tariffs).toEqual(DEFAULT_SEO.pages.tariffs);
  });

  it("полностью заполненные данные — используются как есть, без подмешивания дефолта", async () => {
    const full = { ogImage: "og.png", metrikaId: "98765432", customCode: "<script>1</script>", pages: { home: { title: "H", description: "HD" }, tariffs: { title: "T", description: "TD" } } };
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: full }, error: null }) as never);
    expect(await loadSeoSettings()).toEqual(full);
  });

  it("настройки без metrikaId (сохранены до появления поля) — счётчик выключен, остальное не тронуто", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { ogImage: "og.png" } }, error: null }) as never);
    const res = await loadSeoSettings();
    expect(res.metrikaId).toBe("");
    expect(res.ogImage).toBe("og.png");
  });

  it("customCode: сохранённый код возвращается как есть, а если его нет или он не строка — пусто", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { customCode: "<script>ym(1,'reachGoal','x')</script>" } }, error: null }) as never);
    expect((await loadSeoSettings()).customCode).toBe("<script>ym(1,'reachGoal','x')</script>");
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { customCode: 42 } }, error: null }) as never);
    expect((await loadSeoSettings()).customCode).toBe("");
  });

  it("metrikaId из БД, не похожий на номер (испорченные данные) — отбрасывается, а не подставляется на страницу", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { metrikaId: '"><script>x</script>' } }, error: null }) as never);
    expect((await loadSeoSettings()).metrikaId).toBe("");
  });
});
