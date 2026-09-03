// DEFAULT_SYSTEM_PROMPT здесь обязан оставаться синхронным с DEFAULT_POLICY в
// docker/api/prompt.js (см. комментарий в исходнике) — это то, чем засеяна БД при первом старте
// И то, на что откатывает «Восстановить дефолт» в админке; если тексты разойдутся, кнопка сброса
// в админке начнёт врать о том, что реально станет системным промптом на сервере.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, loadSystemPrompt } from "./aiPrompt";
// @ts-expect-error — обычный JS-модуль вне tsconfig include (src/), деклараций типов нет и не нужно
import { DEFAULT_POLICY } from "../../docker/api/prompt.js";
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

describe("DEFAULT_SYSTEM_PROMPT ⇄ docker/api/prompt.js DEFAULT_POLICY", () => {
  it("остаются побайтово идентичными — это заявленный инвариант, не совпадение", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(DEFAULT_POLICY);
  });
});

describe("loadSystemPrompt", () => {
  it("ничего не сохранено — дефолт", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: null }) as never);
    expect(await loadSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("ошибка запроса — дефолт, не исключение", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: null, error: { message: "boom" } }) as never);
    expect(await loadSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("сохранён только пробельный текст — трактуется как «не задан», дефолт", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { value: { text: "   \n  " } }, error: null }) as never);
    expect(await loadSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("сохранён реальный кастомный текст — используется как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockResult({ data: { value: { text: "Мой кастомный промпт" } }, error: null }) as never);
    expect(await loadSystemPrompt()).toBe("Мой кастомный промпт");
  });
});
