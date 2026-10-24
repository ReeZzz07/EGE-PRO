// Главная: блок тарифов с ценами (его же видят роботы), «принцип платформы» и подписи из общего JSON, без противоречия про предметы.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  vi.mocked(tariffsContent.loadTariffsContent).mockResolvedValue({ eyebrow: "", title: "", subtitle: "", perSubjectNote: "при поштучной покупке — от 1290 ₽/мес за предмет", paymentNote: "Разовая оплата на 30 дней, без автосписаний." });
});

describe("Landing", () => {
  it("блок тарифов: HTML-таблица с ценой, предметами и лимитом ИИ, условия оплаты; кнопка ведёт на страницу тарифов", async () => {
    const onNav = vi.fn();
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={onNav} />);
    expect(await screen.findByText("АТТЕСТАТ")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Тариф", "Цена", "Предметы", "ИИ-репетитор"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/Попробовать\s*0 ₽\s*2 на выбор\s*до 3 обращений в день/);
    expect(rows[2]).toHaveTextContent(/АТТЕСТАТ\s*1\s990 ₽ за 30 дней\s*2 на выбор\s*без лимита/);
    expect(screen.getByText(/На всех тарифах есть диагностика, персональный план и пробные варианты\. При поштучной покупке — от 1290 ₽\/мес за предмет\./)).toBeInTheDocument();
    expect(screen.getByText(/без автопродления\. Тариф включается сразу после оплаты, чек приходит на почту\./)).toBeInTheDocument();
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

  it("новые блоки: короткий ответ с живыми цифрами, три уровня подсказок, отличия, проверка сочинений, ограничения, родителям", async () => {
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={vi.fn()} />);
    await screen.findByText("АТТЕСТАТ");
    expect(screen.getByRole("heading", { name: "Что такое ЕГЭ·ПРО" })).toBeInTheDocument();
    expect(screen.getByText(/В банке 51\s391 задание в формате Открытого банка заданий ФИПИ по 3 предметам\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Три уровня подсказок" })).toBeInTheDocument();
    expect(screen.getByText("Уровень 3: почти полный разбор")).toBeInTheDocument();
    const diff = screen.getByRole("heading", { name: "Чем ИИ-репетитор ЕГЭ·ПРО отличается от обычной нейросети" }).closest("section")!;
    expect(within(diff).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/В банке 7\s232 задания с развёрнутым ответом\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ограничения — честно" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Для родителей" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{(tasks|subjects|essay)\}/);
    expect(document.body.textContent).not.toMatch(/возврат/i);
  });

  it("кнопки запуска диагностики: первый экран, после «Как это устроено» и в конце страницы", async () => {
    const onStart = vi.fn();
    render(<Landing onStart={onStart} onLogin={vi.fn()} onNav={vi.fn()} />);
    await screen.findByText("АТТЕСТАТ");
    // после «Как это устроено» и в конце страницы — обе с подписью «Пройти диагностику»; на первом экране — две кнопки героя
    const bottom = screen.getAllByRole("button", { name: /Пройти диагностику/ });
    expect(bottom).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Определить свой уровень|Начать бесплатно/ })).toHaveLength(2);
    fireEvent.click(bottom[0]);
    fireEvent.click(bottom[1]);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("ссылки из ТЗ: статья о диагностике, сравнение с живым репетитором — переходы без перезагрузки; /parents — страница для родителей", async () => {
    const onNav = vi.fn();
    render(<Landing onStart={vi.fn()} onLogin={vi.fn()} onNav={onNav} />);
    await screen.findByText("АТТЕСТАТ");
    fireEvent.click(screen.getByRole("link", { name: "как работает диагностика и персональный план" }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "blog-article", slug: "kak-rabotaet-diagnostika-i-plan" });
    fireEvent.click(screen.getByRole("link", { name: "ИИ-репетитор против живого репетитора" }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "blog-article", slug: "ii-repetitor-protiv-zhivogo-repetitora" });
    const parents = screen.getByRole("link", { name: "Страница для родителей" });
    expect(parents).toHaveAttribute("href", "/parents");
    fireEvent.click(parents);
    expect(onNav).toHaveBeenLastCalledWith({ name: "parents" });
  });
});
