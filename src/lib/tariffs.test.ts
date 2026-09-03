// useEssayCheckAllowed — гейт "проверка сочинений только на платных тарифах" на клиенте
// (см. EssayView.tsx/MockExam.tsx). Это только UI-подсказка (честная разметка ограничения ДО
// обращения к серверу, см. src/lib/tariffs.ts) — настоящая защита живёт на сервере и уже покрыта
// docker/api/test/tariffGate.test.js (isEssayCheckAllowed). Здесь проверяем именно клиентское
// зеркало того же условия: priceRub > 0 или админ.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEssayCheckAllowed } from "./tariffs";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}));

function mockTariffsResult(rows: { id: string; price_rub: number }[]) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: (resolve: (v: { data: typeof rows; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  return builder;
}

const TARIFF_ROWS = [
  { id: "free", price_rub: 0 },
  { id: "attestat", price_rub: 1990 },
];

describe("useEssayCheckAllowed", () => {
  it("null, пока профиль не загружен, — false (гость)", () => {
    const { result } = renderHook(() => useEssayCheckAllowed(null));
    expect(result.current).toBe(false);
  });

  it("админ — true сразу, без запроса к тарифам", () => {
    vi.mocked(supabase!.from).mockClear();
    const { result } = renderHook(() => useEssayCheckAllowed({ isAdmin: true, tariffId: "free" }));
    expect(result.current).toBe(true);
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it("бесплатный тариф — false после загрузки", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockTariffsResult(TARIFF_ROWS) as never);
    const { result } = renderHook(() => useEssayCheckAllowed({ isAdmin: false, tariffId: "free" }));
    expect(result.current).toBe(null); // ещё грузится
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("платный тариф — true после загрузки", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockTariffsResult(TARIFF_ROWS) as never);
    const { result } = renderHook(() => useEssayCheckAllowed({ isAdmin: false, tariffId: "attestat" }));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("неизвестный/удалённый тариф — false, а не исключение", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockTariffsResult(TARIFF_ROWS) as never);
    const { result } = renderHook(() => useEssayCheckAllowed({ isAdmin: false, tariffId: "deleted-tariff" }));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
