import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import CheckEmailView from "./CheckEmailView";
import { mailboxLink } from "../lib/mailboxLink";

const resendVerification = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ resendVerification }) }));
vi.mock("../lib/metrika", () => ({ reachGoalOnce: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  resendVerification.mockReset();
  resendVerification.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("mailboxLink", () => {
  it("Gmail — поиск по всей почте (включая спам); Яндекс, Mail.ru и другие — их веб-почта; неизвестный сервис — ничего", () => {
    const g = mailboxLink("Anna@Gmail.com")!;
    expect(g.url).toContain("mail.google.com");
    expect(decodeURIComponent(g.url)).toContain("in:anywhere");
    expect(g.label).toMatch(/Спам/);
    expect(mailboxLink("a@mail.ru")!.url).toBe("https://e.mail.ru/inbox/");
    expect(mailboxLink("a@yandex.ru")!.url).toBe("https://mail.yandex.ru/");
    expect(mailboxLink("a@ya.ru")!.url).toBe("https://mail.yandex.ru/");
    expect(mailboxLink("a@icloud.com")!.url).toContain("icloud.com");
    expect(mailboxLink("a@outlook.com")!.url).toContain("outlook");
    expect(mailboxLink("a@corp-school.example")).toBeNull();
    expect(mailboxLink("не-почта")).toBeNull();
  });
});

describe("CheckEmailView", () => {
  it("показывает адрес, кнопку «Найти письмо в Gmail», подсказку про спам и тему письма", () => {
    render(<CheckEmailView email="anna@gmail.com" onNav={vi.fn()} />);
    expect(screen.getByText("anna@gmail.com")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Найти письмо в Gmail/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(/Подтверди email — ЕГЭ·ПРО/)).toBeInTheDocument();
    expect(screen.getByText(/«Спам», «Промоакции»/)).toBeInTheDocument();
  });

  it("для неизвестного почтового сервиса кнопки «Открыть почту» нет, остальная помощь на месте", () => {
    render(<CheckEmailView email="a@corp-school.example" onNav={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отправить ещё раз/ })).toBeInTheDocument();
  });

  it("повторная отправка недоступна первые 45 секунд (идёт таймер), потом работает и снова включает таймер", async () => {
    render(<CheckEmailView email="a@mail.ru" onNav={vi.fn()} />);
    const btn = () => screen.getByRole("button", { name: /Отправить/ });
    expect(btn()).toBeDisabled();
    expect(btn()).toHaveTextContent("через 45 с");
    for (let i = 0; i < 45; i++) await act(async () => void vi.advanceTimersByTime(1000));
    expect(btn()).toBeEnabled();
    await act(async () => {
      fireEvent.click(btn());
    });
    expect(resendVerification).toHaveBeenCalledWith("a@mail.ru");
    expect(screen.getByText("Письмо отправлено повторно")).toBeInTheDocument();
    expect(btn()).toBeDisabled();
  });

  it("ошибка повторной отправки показывается, таймер не сбрасывается", async () => {
    resendVerification.mockResolvedValue({ error: "Слишком много запросов" });
    render(<CheckEmailView email="a@mail.ru" onNav={vi.fn()} />);
    for (let i = 0; i < 45; i++) await act(async () => void vi.advanceTimersByTime(1000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Отправить/ }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Слишком много запросов");
    expect(screen.getByRole("button", { name: /Отправить/ })).toBeEnabled();
  });

  it("ссылки: исправить адрес → регистрация, войти → вход, не пришло → форма обращения с темой «проблема с сайтом»", () => {
    const onNav = vi.fn();
    render(<CheckEmailView email="a@mail.ru" onNav={onNav} />);
    fireEvent.click(screen.getByRole("button", { name: /Ошибся в адресе/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "auth", mode: "signup" });
    fireEvent.click(screen.getByRole("button", { name: /Уже подтвердил/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "auth", mode: "login" });
    fireEvent.click(screen.getByRole("button", { name: /Напиши нам/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "contacts", topic: "bug" });
  });
});
