import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ParentsView from "./ParentsView";
import * as tariffsLib from "../lib/tariffs";

vi.mock("../lib/useDocumentHead", () => ({ useDocumentHead: vi.fn() }));
vi.mock("../lib/seo", async (orig) => ({ ...(await orig<typeof import("../lib/seo")>()), loadSeoSettings: vi.fn().mockResolvedValue({ ogImage: "" }) }));
vi.mock("../lib/tariffs", async (orig) => ({ ...(await orig<typeof import("../lib/tariffs")>()), loadActiveTariffs: vi.fn() }));

const t = (id: string, name: string, priceRub: number, subjectsCount: number): tariffsLib.Tariff => ({
  id, name, badge: null, priceRub, salePriceRub: null, subjectsCount, dailyAiLimit: null, features: [], sortOrder: 0, isActive: true,
});

beforeEach(() => {
  vi.mocked(tariffsLib.loadActiveTariffs).mockResolvedValue([t("free", "Попробовать", 0, 2), t("attestat", "АТТЕСТАТ", 1990, 2), t("vuz", "ВУЗ", 3990, 4)]);
});

const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("ParentsView", () => {
  it("блока с расчётом «Сколько стоит подготовка семье» нет: ни ползунков, ни полей цены", async () => {
    render(<ParentsView onNav={vi.fn()} />);
    await screen.findByRole("columnheader", { name: "ЕГЭ·ПРО" });
    expect(screen.queryByText("Сколько стоит подготовка семье")).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Цена одного занятия/)).not.toBeInTheDocument();
  });

  it("таблица «Репетитор и ЕГЭ·ПРО»: ЕГЭ·ПРО выделен колонкой, стоимость берёт минимальную цену из тарифов", async () => {
    render(<ParentsView onNav={vi.fn()} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Живой репетитор" })).toBeInTheDocument();
    const costRow = within(table).getByRole("rowheader", { name: "Стоимость" }).closest("tr")!;
    expect(norm(costRow.textContent)).toContain("От 1 990 ₽ за 30 дней");
    expect(norm(costRow.textContent)).toContain("количество занятий не ограничено");
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const name of ["Когда заниматься", "Объём практики", "Объяснение", "Личный план", "Подготовка к экзамену"]) {
      expect(within(table).getByRole("rowheader", { name })).toBeInTheDocument();
    }
  });

  it("в таблице только то, что платформа реально делает (ничего про гарантии баллов и «лучше репетитора»)", async () => {
    render(<ParentsView onNav={vi.fn()} />);
    const table = await screen.findByRole("table");
    const text = norm(table.textContent);
    expect(text).not.toMatch(/гарант/i);
    expect(text).not.toMatch(/лучше репетитора|заменит репетитора/i);
    expect(text).toMatch(/Более 50 тысяч заданий/);
    expect(text).toMatch(/три уровня подсказок/);
  });

  it("ответ про замену репетитору дружелюбный к платформе, но без обещаний результата", async () => {
    render(<ParentsView onNav={vi.fn()} />);
    const q = await screen.findByText("Это замена репетитору?");
    const answer = norm(q.parentElement!.textContent);
    expect(answer).toMatch(/основным способом подготовки/);
    expect(answer).not.toMatch(/гаранти(руем|я)/i);
  });

  it("кнопки в начале: бесплатный старт ведёт на регистрацию, тарифы — на страницу тарифов", async () => {
    const onNav = vi.fn();
    render(<ParentsView onNav={onNav} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Начать бесплатно" }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "auth", mode: "signup" });
    fireEvent.click(screen.getAllByRole("button", { name: "Посмотреть тарифы" })[0]);
    expect(onNav).toHaveBeenLastCalledWith({ name: "tariffs" });
  });
});
