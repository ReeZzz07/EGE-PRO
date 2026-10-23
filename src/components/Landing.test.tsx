// Главная: блок тарифов с ценами (его же видят роботы), «принцип платформы» и подписи из общего JSON, без противоречия про предметы.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Landing from "./Landing";
import * as tariffsLib from "../lib/tariffs";
import * as tariffsContent from "../lib/tariffsContent";
import { DEFAULT_CONTENT } from "../lib/content";

vi.mock("./ReviewsSection", () => ({ default: () => null }));
vi.mock("../lib/content", async (orig) => {
  const m = await orig<typeof import("../lib/content")>();
  return { ...m, loadLandingContent: vi.fn().mockResolvedValue(m.DEFAULT_CONTENT) };
});
vi.mock("../lib/tariffs", async (orig) => ({ ...(await orig<typeof import("../lib/tariffs")>()), loadActiveTariffs: vi.fn() }));
vi.mock("../lib/tariffsContent", async (orig) => ({ ...(await orig<typeof import("../lib/tariffsContent")>()), loadTariffsContent: vi.fn() }));
vi.mock("../lib/dbTasks", async (orig) => ({
  ...(await orig<typeof import("../lib/dbTasks")>()),
  useTasksVersion: () => 0,
  getAvailableSubjects: () => ["math", "rus", "fiz"],
  getSubjectTotal: () => 100,
  getGlobalTaskTotal: () => 51391,
  getGlobalPointsTotal: () => 84867,
  getEssayTaskTotal: () => 7232,
}));

const tariffs = [
  { id: "free", name: "Попробовать", badge: null, priceRub: 0, salePriceRub: null, subjectsCount: 2, dailyAiLimit: 3, features: [], sortOrder: 0, isActive: true },
  { id: "attestat", name: "АТТЕСТАТ", badge: null, priceRub: 1990, salePriceRub: null, subjectsCount: 2, dailyAiLimit: null, features: [], sortOrder: 1, isActive: true },
];

beforeEach(() => {
  vi.mocked(tariffsLib.loadActiveTariffs).mockResolvedValue(tariffs as never);
  vi.mocked(tariffsContent.loadTariffsContent).mockResolvedValue({ eyebrow: "", title: "", subtitle: "", perSubjectNote: "", paymentNote: "Разовая оплата на 30 дней, без автосписаний." });
});

describe("Landing", () => {
  it("блок тарифов: цены, срок, предметы, лимит ИИ и условия оплаты; кнопка ведёт на страницу тарифов", async () => {
    const onNav = vi.fn();
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={onNav} />);
    expect(await screen.findByText("АТТЕСТАТ")).toBeInTheDocument();
    expect(screen.getByText(/1\s990 ₽/)).toBeInTheDocument();
    expect(screen.getByText("бесплатно")).toBeInTheDocument();
    expect(screen.getByText("до 3 обращений к ИИ-репетитору в день")).toBeInTheDocument();
    expect(screen.getByText("Разовая оплата на 30 дней, без автосписаний.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Все тарифы и условия оплаты" }));
    expect(onNav).toHaveBeenCalledWith({ name: "tariffs" });
  });

  it("принцип платформы и пример диалога на месте; цифры банка и пример задания из общего файла", async () => {
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={vi.fn()} />);
    expect(await screen.findByText("ИИ не решает за тебя, а помогает разобраться.")).toBeInTheDocument();
    expect(screen.getByText("Просто скажи ответ, мне некогда")).toBeInTheDocument();
    expect(screen.getByText(/Методическая опора:/)).toBeInTheDocument();
    expect(screen.getByText("84867")).toBeInTheDocument();
    expect(screen.getByText("7232")).toBeInTheDocument();
    expect(screen.getByText("№ 99566")).toBeInTheDocument();
  });

  it("предметы: без «Скоро добавим…» рядом с «Начни с любого из N» — число совпадает с числом доступных предметов", async () => {
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={vi.fn()} />);
    expect(await screen.findByText("Начни с любого из 3 предметов — дальше сможешь тренировать все.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Скоро добавим/);
  });

  it("герой: обе кнопки запускают диагностику, текст берётся из общего файла", async () => {
    const onStart = vi.fn();
    render(<Landing onStart={onStart} onLogin={vi.fn()} onNav={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Определить свой уровень/ }));
    fireEvent.click(screen.getByRole("button", { name: "Начать бесплатно" }));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(DEFAULT_CONTENT.hero.title.length).toBeGreaterThan(0);
  });
});
