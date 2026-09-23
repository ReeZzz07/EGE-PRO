// RenewView и SubscriptionBanner — продление «как было»: страница показывает прежний состав
// (тариф + докупленные предметы) и итоговую сумму от сервера, плашка появляется для истёкшего тарифа
// и за несколько дней до конца.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RenewView from "./RenewView";
import SubscriptionBanner, { needsSubscriptionAttention } from "./SubscriptionBanner";
import { daysLabel, splitSubjects, startRenewalPayment, type Subscription } from "../lib/subscription";
import { useAuth } from "../lib/auth";

vi.mock("../lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/metrika", () => ({ reachGoal: vi.fn() }));
vi.mock("../lib/subscription", async (orig) => ({ ...(await orig<typeof import("../lib/subscription")>()), startRenewalPayment: vi.fn() }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));

const base: Subscription = {
  isAdmin: false,
  tariffId: "vuz",
  tariffName: "ВУЗ",
  paid: true,
  expiresAt: "2026-09-10T00:00:00.000Z",
  active: false,
  expired: true,
  daysLeft: null,
  extraSubjects: 1,
  subjectsCap: 2,
  activeSubjects: ["rus", "math_base"],
  frozenSubjects: ["fiz", "chem", "hist"],
  renewal: { tariffId: "vuz", tariffName: "ВУЗ", extraSubjects: 1, tariffPriceRub: 3990, addonsPriceRub: 1290, discountPercent: null, amountRub: 5280, periodDays: 30 },
  addon: null,
};

function mockAuth(sub: Subscription | null) {
  vi.mocked(useAuth).mockReturnValue({ profile: { id: "u1", subscription: sub }, refreshProfile: vi.fn() } as never);
}

describe("splitSubjects / daysLabel", () => {
  it("первые по порядку остаются доступными, остальные замораживаются; null — без ограничения", () => {
    expect(splitSubjects(["a", "b", "c"], 2)).toEqual({ active: ["a", "b"], frozen: ["c"] });
    expect(splitSubjects(["a", "b"], null)).toEqual({ active: ["a", "b"], frozen: [] });
  });
  it("склонение дней", () => {
    expect(daysLabel(1)).toBe("1 день");
    expect(daysLabel(3)).toBe("3 дня");
    expect(daysLabel(5)).toBe("5 дней");
    expect(daysLabel(11)).toBe("11 дней");
  });
});

describe("needsSubscriptionAttention", () => {
  it("истёкший — да; скоро закончится (≤5 дней) — да; далеко — нет; без renewal/админ — нет", () => {
    expect(needsSubscriptionAttention(base)).toBe(true);
    expect(needsSubscriptionAttention({ ...base, expired: false, active: true, daysLeft: 4 })).toBe(true);
    expect(needsSubscriptionAttention({ ...base, expired: false, active: true, daysLeft: 20 })).toBe(false);
    expect(needsSubscriptionAttention({ ...base, renewal: null })).toBe(false);
    expect(needsSubscriptionAttention({ ...base, isAdmin: true })).toBe(false);
    expect(needsSubscriptionAttention(null)).toBe(false);
  });
});

describe("SubscriptionBanner", () => {
  it("истёкший тариф — сообщает, что данные сохранены и сколько предметов приостановлено; кнопка ведёт на /renew", () => {
    const onNav = vi.fn();
    render(<SubscriptionBanner sub={base} onNav={onNav} />);
    expect(screen.getByText(/закончился/)).toBeInTheDocument();
    expect(screen.getByText(/доступ к 3 предм\. приостановлен/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Продлить · 5.?280/ }));
    expect(onNav).toHaveBeenCalledWith({ name: "renew" });
  });
});

describe("RenewView", () => {
  it("показывает прежний состав, замороженные предметы и итог; оплата запускает продление без выбора тарифа", async () => {
    mockAuth(base);
    vi.mocked(startRenewalPayment).mockResolvedValue({ error: "тест: не открываем ЮKassa" });
    render(<RenewView onNav={vi.fn()} />);
    expect(screen.getByText(/Продлить тариф «ВУЗ»/)).toBeInTheDocument();
    expect(screen.getByText(/Докупленные предметы: 1/)).toBeInTheDocument();
    expect(screen.getByText(/снова откроется доступ к предметам/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Продлить и оплатить/ }));
    await waitFor(() => expect(startRenewalPayment).toHaveBeenCalledTimes(1));
  });

  it("нет платного тарифа — «нечего продлять» и путь к тарифам", () => {
    mockAuth({ ...base, renewal: null, paid: false, expired: false });
    const onNav = vi.fn();
    render(<RenewView onNav={onNav} />);
    expect(screen.getByText("Нечего продлять")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Смотреть тарифы/ }));
    expect(onNav).toHaveBeenCalledWith({ name: "tariffs" });
  });
});
