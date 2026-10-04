import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminAttribution from "./AdminAttribution";
import * as api from "../lib/adminAttribution";

vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));
vi.mock("../lib/adminAttribution", async (orig) => ({ ...(await orig<typeof import("../lib/adminAttribution")>()), loadAttributionReport: vi.fn() }));

const report: api.AttributionReport = {
  rows: [
    { channel: "yandex", campaign: "714646932", regs: 100, confirmed: 70, onboarded: 40, diagnostic: 20, active: 30, paid: 1, revenue: 2793 },
    { channel: "нет данных (до внедрения)", campaign: "—", regs: 126, confirmed: 76, onboarded: 53, diagnostic: 20, active: 31, paid: 0, revenue: 0 },
  ],
  domains: [
    { domain: "gmail.com", regs: 126, confirmed: 66 },
    { domain: "yandex.ru", regs: 30, confirmed: 26 },
  ],
  total: { regs: 226, confirmed: 146, onboarded: 93, diagnostic: 40, active: 61, paid: 1, revenue: 2793 },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(api.loadAttributionReport).mockResolvedValue(report);
});

const lastCall = () => {
  const calls = vi.mocked(api.loadAttributionReport).mock.calls;
  return calls[calls.length - 1]!;
};

describe("AdminAttribution", () => {
  it("таблица: канал, кампания, этапы с долями, итого; почтовые сервисы — с красной долей ниже 60%", async () => {
    render(<AdminAttribution />);
    const row = (await screen.findByText("714646932")).closest("tr")!;
    expect(within(row).getByText("yandex")).toBeInTheDocument();
    expect(row).toHaveTextContent("70 (70%)");
    expect(row).toHaveTextContent("20 (20%)");
    expect(row).toHaveTextContent("2 793");
    expect(screen.getByText("нет данных (до внедрения)")).toBeInTheDocument();
    const total = screen.getByText("Итого").closest("tr")!;
    expect(total).toHaveTextContent("226");
    expect(total).toHaveTextContent("146 (65%)");
    expect(total).toHaveTextContent("40 (18%)");

    const gmail = screen.getByText("gmail.com").closest("li")!;
    expect(gmail).toHaveTextContent("66 из 126 · 52%");
    expect(gmail.querySelector(".text-red")).not.toBeNull();
    expect(screen.getByText("yandex.ru").closest("li")!.querySelector(".text-red")).toBeNull();
  });

  it("расход на рекламу → стоимость этапов (запоминается в браузере)", async () => {
    render(<AdminAttribution />);
    await screen.findByText("Итого");
    expect(screen.queryByLabelText("Стоимость этапов")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Расход на рекламу/), { target: { value: "32455,67" } });
    const costs = screen.getByLabelText("Стоимость этапов");
    expect(costs).toHaveTextContent("за регистрацию");
    expect(costs).toHaveTextContent("144 ₽"); // 32455,67 / 226
    expect(costs).toHaveTextContent("811 ₽"); // / 40 диагностик
    expect(costs).toHaveTextContent("32 456 ₽"); // / 1 оплата
    expect(localStorage.getItem("ege-pro.attribution-spend")).toBe("32455,67");
  });

  it("период: пресеты и даты уходят в запрос; «Всё время» сбрасывает", async () => {
    render(<AdminAttribution />);
    await screen.findByText("Итого");
    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));
    await waitFor(() => expect(lastCall()[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    fireEvent.click(screen.getByRole("button", { name: "Всё время" }));
    await waitFor(() => expect(lastCall()).toEqual([undefined, undefined]));
  });

  it("шаблон меток для Директа показан и копируется", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AdminAttribution />);
    await screen.findByText("Итого");
    expect(screen.getByText(api.DIRECT_UTM_TEMPLATE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(api.DIRECT_UTM_TEMPLATE));
  });

  it("ошибка загрузки отчёта показывается, а не пустая страница", async () => {
    vi.mocked(api.loadAttributionReport).mockResolvedValue(null);
    render(<AdminAttribution />);
    expect(await screen.findByText("Не удалось загрузить отчёт.")).toBeInTheDocument();
  });
});
