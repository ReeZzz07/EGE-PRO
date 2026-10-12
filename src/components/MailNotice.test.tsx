// Объявление «письма временно не приходят» на экранах регистрации/входа и «Подтверди почту».
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MailNotice from "./MailNotice";
import CheckEmailView from "./CheckEmailView";
import AuthScreen from "./AuthScreen";
import * as api from "../lib/mailNotice";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ resendVerification: vi.fn(), signUp: vi.fn(), signIn: vi.fn(), forgotPassword: vi.fn(), isGuestMode: false }),
}));
vi.mock("../lib/metrika", () => ({ reachGoalOnce: vi.fn() }));
vi.mock("../lib/mailNotice", async (orig) => ({ ...(await orig<typeof import("../lib/mailNotice")>()), loadPublicMailNotice: vi.fn() }));

const ACTIVE = { active: true, text: "Яндекс уже устраняет неполадку, скоро всё заработает." };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.loadPublicMailNotice).mockResolvedValue({ active: false, text: "" });
});

describe("MailNotice", () => {
  it("активное объявление показывается с текстом админа и сообщает родителю, что оно активно", async () => {
    vi.mocked(api.loadPublicMailNotice).mockResolvedValue(ACTIVE);
    const onActive = vi.fn();
    render(<MailNotice onActive={onActive} />);
    const box = await screen.findByTestId("mail-notice");
    expect(box).toHaveTextContent("Письма временно не приходят");
    expect(box).toHaveTextContent("Яндекс уже устраняет неполадку");
    expect(onActive).toHaveBeenCalledWith(true);
  });

  it("нет объявления — ничего не рисуется", async () => {
    const onActive = vi.fn();
    render(<MailNotice onActive={onActive} />);
    await waitFor(() => expect(onActive).toHaveBeenCalledWith(false));
    expect(screen.queryByTestId("mail-notice")).not.toBeInTheDocument();
  });
});

describe("экраны с объявлением", () => {
  it("«Подтверди почту» при сбое: объявление вместо подсказок про «Спам» и без «мы отправили письмо»", async () => {
    vi.mocked(api.loadPublicMailNotice).mockResolvedValue(ACTIVE);
    render(<CheckEmailView email="anna@gmail.com" onNav={vi.fn()} />);
    expect(await screen.findByTestId("mail-notice")).toBeInTheDocument();
    expect(screen.queryByText(/Письма нет больше пары минут/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Найти письмо в Gmail/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Мы отправили письмо на/)).not.toBeInTheDocument();
    expect(screen.getByText(/Аккаунт для/)).toBeInTheDocument();
    expect(screen.getByText("anna@gmail.com")).toBeInTheDocument();
  });

  it("«Подтверди почту» без сбоя выглядит как раньше", async () => {
    render(<CheckEmailView email="anna@gmail.com" onNav={vi.fn()} />);
    await waitFor(() => expect(api.loadPublicMailNotice).toHaveBeenCalled());
    expect(screen.getByText(/Мы отправили письмо на/)).toBeInTheDocument();
    expect(screen.getByText(/Письма нет больше пары минут/)).toBeInTheDocument();
    expect(screen.queryByTestId("mail-notice")).not.toBeInTheDocument();
  });

  it("форма регистрации показывает объявление до отправки формы", async () => {
    vi.mocked(api.loadPublicMailNotice).mockResolvedValue(ACTIVE);
    render(<AuthScreen onSuccess={vi.fn()} onNav={vi.fn()} />);
    expect(await screen.findByTestId("mail-notice")).toHaveTextContent("скоро всё заработает");
    expect(screen.getByRole("button", { name: "Создать профиль" })).toBeInTheDocument();
  });
});
