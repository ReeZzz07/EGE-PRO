import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ParentPayView from "./ParentPayView";
import * as api from "../lib/parentPay";
import { reachGoal, trackPurchase } from "../lib/metrika";

vi.mock("../lib/metrika", () => ({ reachGoal: vi.fn((_g: string, _p: unknown, cb?: () => void) => cb?.()), reachGoalOnce: vi.fn(), trackPurchase: vi.fn() }));
vi.mock("../lib/useDocumentHead", () => ({ useDocumentHead: vi.fn() }));
vi.mock("../lib/parentPay", async (orig) => ({
  ...(await orig<typeof import("../lib/parentPay")>()),
  loadParentView: vi.fn(),
  startParentPayment: vi.fn(),
  getParentPaymentStatus: vi.fn(),
}));

const TOKEN = "abcdefghijklmnopqrstuvwx";
const PAYMENT = "11111111-2222-3333-4444-555555555555";
const VIEW: api.ParentPublicView = {
  expired: false,
  studentName: "Мария",
  tasksSolved: 5,
  diagnosticDone: true,
  discountPercent: 30,
  discountUntil: null,
  tariffs: [
    { id: "attestat", name: "АТТЕСТАТ", badge: null, basePrice: 1990, finalPrice: 1393, subjectsCount: 2, dailyAiLimit: null, features: ["2 предмета на выбор"] },
    { id: "vuz", name: "ВУЗ", badge: "Популярный", basePrice: 3990, finalPrice: 2793, subjectsCount: 4, dailyAiLimit: null, features: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadParentView).mockResolvedValue({ view: VIEW });
  vi.mocked(api.startParentPayment).mockResolvedValue({ confirmationUrl: "https://yookassa.test/pay" });
});

describe("ParentPayView", () => {
  it("имя ребёнка, прогресс, скидка, тарифы с зачёркнутой ценой; популярный выбран по умолчанию", async () => {
    render(<ParentPayView token={TOKEN} onNav={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Мария просит помочь");
    expect(screen.getByText(/решено 5 заданий, пройдена диагностика/)).toBeInTheDocument();
    expect(screen.getByText(/скидка −30%/)).toBeInTheDocument();
    expect(screen.getByText(/2\s793\s₽/)).toBeInTheDocument();
    expect(screen.getByText(/3\s990\s₽/).className).toContain("line-through");
    expect(screen.getByRole("radio", { name: /ВУЗ/ })).toBeChecked();
  });

  it("кнопки оплаты недоступны, пока не указана почта для чека; потом СБП идёт с выбранным тарифом и способом", async () => {
    render(<ParentPayView token={TOKEN} onNav={vi.fn()} />);
    await screen.findByRole("heading", { level: 1 });
    const card = screen.getByRole("button", { name: "Оплатить картой" });
    const sbp = screen.getByRole("button", { name: "Оплатить через СБП" });
    expect(card).toBeDisabled();
    expect(sbp).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ваша почта для чека"), { target: { value: " mama@mail.ru " } });
    fireEvent.click(screen.getByRole("radio", { name: /АТТЕСТАТ/ }));
    expect(sbp).toBeEnabled();
    // jsdom не умеет навигацию — подменяем location, чтобы переход на оплату можно было проверить
    const loc = { href: "" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    fireEvent.click(sbp);
    await waitFor(() => expect(api.startParentPayment).toHaveBeenCalledWith(TOKEN, { tariffId: "attestat", email: "mama@mail.ru", method: "sbp" }));
    expect(reachGoal).toHaveBeenCalledWith("parent_pay_start", { tariff: "attestat", method: "sbp" }, expect.any(Function));
    await waitFor(() => expect(loc.href).toBe("https://yookassa.test/pay"));
  });

  it("ошибка создания платежа показывается и оставляет кнопки доступными", async () => {
    vi.mocked(api.startParentPayment).mockResolvedValue({ error: "Проверь email — похоже, в адресе опечатка" });
    render(<ParentPayView token={TOKEN} onNav={vi.fn()} />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.change(screen.getByLabelText("Ваша почта для чека"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Оплатить картой" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("опечатка");
    expect(screen.getByRole("button", { name: "Оплатить картой" })).toBeEnabled();
  });

  it("ссылка не найдена и ссылка истекла — отдельные понятные сообщения, формы оплаты нет", async () => {
    vi.mocked(api.loadParentView).mockResolvedValueOnce({ notFound: true });
    const { unmount } = render(<ParentPayView token={TOKEN} onNav={vi.fn()} />);
    expect(await screen.findByText("Ссылка не найдена")).toBeInTheDocument();
    unmount();
    vi.mocked(api.loadParentView).mockResolvedValueOnce({ view: { expired: true } });
    render(<ParentPayView token={TOKEN} onNav={vi.fn()} />);
    expect(await screen.findByText("Срок действия ссылки истёк")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Оплатить картой" })).not.toBeInTheDocument();
  });

  it("возврат после оплаты: успех — благодарность и цель purchase; отмена — можно попробовать ещё раз", async () => {
    vi.mocked(api.getParentPaymentStatus).mockResolvedValueOnce({ status: "succeeded", amountRub: 2793, tariffId: "vuz", studentName: "Мария" });
    const { unmount } = render(<ParentPayView token={TOKEN} paymentId={PAYMENT} onNav={vi.fn()} />);
    expect(await screen.findByText("Спасибо, оплата прошла")).toBeInTheDocument();
    expect(trackPurchase).toHaveBeenCalledWith({ paymentId: PAYMENT, amountRub: 2793, tariffId: "vuz" });
    unmount();

    vi.mocked(api.getParentPaymentStatus).mockResolvedValueOnce({ status: "canceled" });
    const onNav = vi.fn();
    render(<ParentPayView token={TOKEN} paymentId={PAYMENT} onNav={onNav} />);
    expect(await screen.findByText("Оплата не прошла")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Попробовать ещё раз" }));
    expect(onNav).toHaveBeenCalledWith({ name: "parent-pay", token: TOKEN });
    expect(await screen.findByRole("button", { name: "Оплатить картой" })).toBeInTheDocument();
  });
});
