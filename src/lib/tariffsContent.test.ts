// loadTariffsContent — маркетинговый текст вокруг карточек тарифов; частично сохранённые поля
// не должны стирать остальные (то же семейство поведения, что seo.ts/content.ts, но плоский
// объект вместо вложенных страниц/ключей).
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TARIFFS_CONTENT, loadTariffsContent } from "./tariffsContent";
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

describe("loadTariffsContent", () => {
  it("ничего не сохранено — дефолт", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: null }) as never);
    expect(await loadTariffsContent()).toEqual(DEFAULT_TARIFFS_CONTENT);
  });

  it("частично сохранено (только title) — остальные поля из дефолта", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { data: { title: "Новый заголовок" } }, error: null }) as never);
    const res = await loadTariffsContent();
    expect(res.title).toBe("Новый заголовок");
    expect(res.paymentNote).toBe(DEFAULT_TARIFFS_CONTENT.paymentNote);
  });
});
