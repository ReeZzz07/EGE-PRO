// useEssayCheckAllowed — гейт "проверка сочинений только на платных тарифах" на клиенте
// (см. EssayView.tsx/MockExam.tsx). Это только UI-подсказка (честная разметка ограничения ДО
// обращения к серверу, см. src/lib/tariffs.ts) — настоящая защита живёт на сервере и уже покрыта
// docker/api/test/tariffGate.test.js (isEssayCheckAllowed). Здесь проверяем именно клиентское
// зеркало того же условия: priceRub > 0 или админ.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTariff, deleteTariff, updateTariff, useEssayCheckAllowed, type TariffInput } from "./tariffs";
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

// ─────────────────────── CRUD (админка) — перевод ошибок БД в понятные сообщения ───────────────────────

function mockWriteResult(error: { message: string } | null) {
  const builder: Record<string, unknown> = {
    insert: () => Promise.resolve({ error }),
    update: () => builder,
    eq: () => Promise.resolve({ error }),
    delete: () => builder,
  };
  return builder;
}

const tariffInput: TariffInput = {
  id: "test",
  name: "Тест",
  badge: null,
  priceRub: 1990,
  salePriceRub: null,
  subjectsCount: 2,
  dailyAiLimit: null,
  features: [],
  isActive: true,
};

describe("createTariff", () => {
  it("успех — пустой объект без error", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult(null) as never);
    expect(await createTariff(tariffInput)).toEqual({});
  });

  it("нарушение ограничения sale_price < price — понятное сообщение вместо имени constraint", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult({ message: 'new row violates check constraint "tariffs_sale_price_valid"' }) as never);
    const res = await createTariff(tariffInput);
    expect(res.error).toBe("Цена со скидкой должна быть меньше обычной цены (и не отрицательной).");
  });

  it("прочая ошибка БД — передаётся как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult({ message: "duplicate key" }) as never);
    expect((await createTariff(tariffInput)).error).toBe("duplicate key");
  });
});

describe("updateTariff", () => {
  it("та же понятная ошибка про скидку применяется и при обновлении", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult({ message: "tariffs_sale_price_valid violated" }) as never);
    const res = await updateTariff("free", { priceRub: 100 });
    expect(res.error).toBe("Цена со скидкой должна быть меньше обычной цены (и не отрицательной).");
  });
});

describe("deleteTariff", () => {
  it("успех — пустой объект без error", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult(null) as never);
    expect(await deleteTariff("free")).toEqual({});
  });

  it("нарушение внешнего ключа (на тарифе есть пользователи) — понятное сообщение с инструкцией", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult({ message: 'update or delete on table "tariffs" violates foreign key constraint' }) as never);
    const res = await deleteTariff("free");
    expect(res.error).toMatch(/на этом тарифе ещё есть пользователи/);
  });

  it("прочая ошибка БД — передаётся как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockWriteResult({ message: "connection refused" }) as never);
    expect((await deleteTariff("free")).error).toBe("connection refused");
  });
});
