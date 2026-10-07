// Адрес для тестовых писем в админке («Почта»): поле наверху вкладки, кнопки в блоках ниже берут адрес из него.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TestRecipientField from "./TestRecipientField";
import AdminWelcomeEmailSettings from "./AdminWelcomeEmailSettings";
import { setTestRecipient } from "../lib/testRecipient";
import { sendTestWelcomeEmail } from "../lib/welcomeEmailSettings";
import { sendTestLifecycleEmail } from "../lib/lifecycleEmails";
import * as supabaseLib from "../lib/supabase";

const push = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "a1", email: "boss@ege-tutor.ru" } }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push }) }));
vi.mock("../lib/supabase", async (orig) => ({ ...(await orig<typeof import("../lib/supabase")>()), isSupabaseConfigured: true, apiFetch: vi.fn() }));
vi.mock("../lib/welcomeEmailSettings", async (orig) => {
  const m = await orig<typeof import("../lib/welcomeEmailSettings")>();
  return { ...m, loadWelcomeEmailSettings: vi.fn().mockResolvedValue(m.DEFAULT_WELCOME_EMAIL_SETTINGS), sendTestWelcomeEmail: vi.fn().mockResolvedValue({ to: "x" }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  act(() => setTestRecipient(""));
});
afterEach(() => act(() => setTestRecipient("")));

describe("TestRecipientField", () => {
  it("пусто — подсказка про свою почту; ввод запоминается в браузере; «Сбросить» возвращает свою почту", () => {
    render(<TestRecipientField />);
    const input = screen.getByLabelText("Куда отправлять тестовые письма");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "boss@ege-tutor.ru");
    fireEvent.change(input, { target: { value: "tester@gmail.com" } });
    expect(input).toHaveValue("tester@gmail.com");
    expect(localStorage.getItem("ege-pro.test-email-to")).toBe("tester@gmail.com");
    fireEvent.click(screen.getByRole("button", { name: "Сбросить на мою почту" }));
    expect(input).toHaveValue("");
    expect(localStorage.getItem("ege-pro.test-email-to")).toBeNull();
  });

  it("некорректный адрес (в том числе кириллицей) подсвечивается понятным текстом", () => {
    render(<TestRecipientField />);
    fireEvent.change(screen.getByLabelText("Куда отправлять тестовые письма"), { target: { value: "мама@почта.рф" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/латиницей/);
    fireEvent.change(screen.getByLabelText("Куда отправлять тестовые письма"), { target: { value: "ok@mail.ru" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Приветственное письмо: тест уходит на выбранный адрес", () => {
  it("по умолчанию — на свою почту (адрес не передаётся); после ввода — на указанный, и кнопка это показывает", async () => {
    render(
      <>
        <TestRecipientField />
        <AdminWelcomeEmailSettings />
      </>
    );
    const btn = await screen.findByRole("button", { name: /Отправить тестовое на boss@ege-tutor\.ru/ });
    fireEvent.click(btn);
    await waitFor(() => expect(sendTestWelcomeEmail).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendTestWelcomeEmail).mock.calls[0][1]).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Куда отправлять тестовые письма"), { target: { value: " Friend@Gmail.com " } });
    const btn2 = await screen.findByRole("button", { name: /Отправить тестовое на Friend@Gmail\.com/ });
    fireEvent.click(btn2);
    await waitFor(() => expect(sendTestWelcomeEmail).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendTestWelcomeEmail).mock.calls[1][1]).toBe("friend@gmail.com");
  });

  it("с некорректным адресом кнопка недоступна и ничего не отправляется", async () => {
    render(
      <>
        <TestRecipientField />
        <AdminWelcomeEmailSettings />
      </>
    );
    fireEvent.change(await screen.findByLabelText("Куда отправлять тестовые письма"), { target: { value: "bad@" } });
    const btn = screen.getByRole("button", { name: /Отправить тестовое на bad@/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(sendTestWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe("запросы к серверу: адрес передаётся только если указан", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body, statusText: "OK" }) as unknown as Response;

  it("приветственное письмо: поле to в теле запроса и адрес из ответа сервера", async () => {
    const real = await vi.importActual<typeof import("../lib/welcomeEmailSettings")>("../lib/welcomeEmailSettings");
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ ok: true, to: "friend@gmail.com" }));
    const settings = real.DEFAULT_WELCOME_EMAIL_SETTINGS;
    const withTo = await real.sendTestWelcomeEmail(settings, "friend@gmail.com");
    expect(withTo.to).toBe("friend@gmail.com");
    expect(JSON.parse(String(vi.mocked(supabaseLib.apiFetch).mock.calls[0][1]?.body))).toMatchObject({ to: "friend@gmail.com", subject: settings.subject });
    await real.sendTestWelcomeEmail(settings);
    expect(JSON.parse(String(vi.mocked(supabaseLib.apiFetch).mock.calls[1][1]?.body))).not.toHaveProperty("to");
  });

  it("письма-напоминания: то же самое; ошибка сервера возвращается текстом", async () => {
    const texts = { subject: "S", bodyText: "B", footer: "" };
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(ok({ ok: true, to: "friend@gmail.com" }));
    expect((await sendTestLifecycleEmail("plan", texts, "friend@gmail.com")).to).toBe("friend@gmail.com");
    expect(JSON.parse(String(vi.mocked(supabaseLib.apiFetch).mock.calls[0][1]?.body))).toMatchObject({ to: "friend@gmail.com", subject: "S" });
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(ok({ ok: true }));
    await sendTestLifecycleEmail("plan", texts);
    expect(JSON.parse(String(vi.mocked(supabaseLib.apiFetch).mock.calls[1][1]?.body))).not.toHaveProperty("to");
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce({ ok: false, statusText: "Bad", json: async () => ({ error: "Проверь email — похоже, в адресе опечатка" }) } as unknown as Response);
    expect((await sendTestLifecycleEmail("plan", texts, "bad@")).error).toMatch(/опечатка/);
  });
});
