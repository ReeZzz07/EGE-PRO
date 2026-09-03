// loadAiSettings — provider белым списком ("qwen" явно, всё остальное → "anthropic"), а не
// пропускается как есть: битое/устаревшее/неожиданное значение в БД не должно тихо превратиться
// в незнакомый provider, который потом сломает выбор callText/callTool на сервере.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS, loadAiSettings } from "./aiSettings";
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

describe("loadAiSettings", () => {
  it("ничего не сохранено — дефолт (anthropic, пустой ключ)", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: null }) as never);
    expect(await loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("ошибка запроса — дефолт, не исключение", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: { message: "boom" } }) as never);
    expect(await loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("provider=qwen сохраняется как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { value: { provider: "qwen", apiKey: "k" } }, error: null }) as never);
    expect((await loadAiSettings()).provider).toBe("qwen");
  });

  it("любое неожиданное значение provider (не «qwen») — тихо становится anthropic, а не проходит как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { value: { provider: "gpt-5-turbo-ultra" } }, error: null }) as never);
    expect((await loadAiSettings()).provider).toBe("anthropic");
  });

  it("частично заполненные данные — недостающие поля берутся из дефолта", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { value: { apiKey: "only-key" } }, error: null }) as never);
    expect(await loadAiSettings()).toEqual({ provider: "anthropic", apiKey: "only-key", model: "", baseUrl: "" });
  });
});
