// «Оплата родителем» в админке: воронка и разбивка по местам, откуда ученики нажимают кнопку.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AdminParentPay from "./AdminParentPay";
import * as api from "../lib/adminParentPay";

vi.mock("../lib/adminParentPay", () => ({ loadParentPayStats: vi.fn() }));

const STATS: api.ParentPayStats = {
  created: 9,
  shared: 7,
  shared_copy: 3,
  shared_whatsapp: 3,
  shared_telegram: 1,
  emails_sent: 2,
  emails_failed: 0,
  opened: 4,
  pay_started: 2,
  paid: 1,
  revenue: 1990,
  places: [
    { place: "ai-limit", requested: 6, opened: 3, paid: 1 },
    { place: "diagnostic-result", requested: 2, opened: 1, paid: 0 },
    { place: "что-то-новое", requested: 1, opened: 0, paid: 0 },
  ],
  reminders: 5,
};

beforeEach(() => vi.mocked(api.loadParentPayStats).mockResolvedValue(STATS));

describe("AdminParentPay", () => {
  it("показывает число напоминаний ученикам и таблицу по местам с понятными подписями", async () => {
    render(<AdminParentPay />);
    expect(await screen.findByText("Напоминаний ученикам отправлено")).toBeInTheDocument();
    const table = screen.getByTestId("parent-pay-places");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Лимит ИИ-репетитора");
    expect(rows[1]).toHaveTextContent(/6\s*3\s*1/);
    expect(rows[2]).toHaveTextContent("Итог диагностики");
    expect(rows[3]).toHaveTextContent("что-то-новое");
  });

  it("если мест ещё нет (до выкатки или без нажатий), таблица не рисуется, а воронка остаётся", async () => {
    vi.mocked(api.loadParentPayStats).mockResolvedValue({ ...STATS, places: [], reminders: 0 });
    render(<AdminParentPay />);
    expect(await screen.findByText("Оплатили")).toBeInTheDocument();
    expect(screen.queryByTestId("parent-pay-places")).not.toBeInTheDocument();
  });
});
