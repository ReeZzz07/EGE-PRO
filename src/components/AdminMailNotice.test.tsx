// /admin → Почта: переключатель объявления о сбое и его текст.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminMailSettings from "./AdminMailSettings";
import * as notice from "../lib/mailNotice";

const push = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "admin-1", isAdmin: true } }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push }) }));
vi.mock("../lib/mailSettings", async (orig) => ({
  ...(await orig<typeof import("../lib/mailSettings")>()),
  loadSmtpSettings: vi.fn().mockResolvedValue({ host: "smtp.yandex.ru", port: 465, user: "noreply@ege-tutor.ru", password: "x", fromName: "ЕГЭ·ПРО", fromAddress: "" }),
}));
vi.mock("../lib/mailNotice", async (orig) => ({
  ...(await orig<typeof import("../lib/mailNotice")>()),
  loadMailNoticeSettings: vi.fn(),
  saveMailNoticeSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notice.loadMailNoticeSettings).mockResolvedValue({ enabled: false, text: "" });
  vi.mocked(notice.saveMailNoticeSettings).mockResolvedValue({});
});

describe("AdminMailSettings: объявление о сбое почты", () => {
  it("«Включить» сохраняет enabled: true вместе с текстом и обновляет состояние", async () => {
    render(<AdminMailSettings />);
    const box = await screen.findByTestId("mail-notice-admin");
    expect(box).toHaveTextContent("Сейчас не показывается");
    fireEvent.change(within(box).getByRole("textbox"), { target: { value: "Яндекс чинит почту" } });
    fireEvent.click(within(box).getByRole("button", { name: "Включить" }));
    await waitFor(() => expect(notice.saveMailNoticeSettings).toHaveBeenCalledWith({ enabled: true, text: "Яндекс чинит почту" }, "admin-1"));
    expect(await within(box).findByText("Сейчас показывается посетителям")).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith(expect.stringContaining("включено"), "ok");
  });

  it("включённое объявление выключается одной кнопкой и текст сохраняется", async () => {
    vi.mocked(notice.loadMailNoticeSettings).mockResolvedValue({ enabled: true, text: "Старый текст" });
    render(<AdminMailSettings />);
    const box = await screen.findByTestId("mail-notice-admin");
    await within(box).findByText("Сейчас показывается посетителям");
    fireEvent.click(within(box).getByRole("button", { name: "Выключить" }));
    await waitFor(() => expect(notice.saveMailNoticeSettings).toHaveBeenCalledWith({ enabled: false, text: "Старый текст" }, "admin-1"));
  });

  it("ошибка сохранения показывается и состояние не меняется", async () => {
    vi.mocked(notice.saveMailNoticeSettings).mockResolvedValue({ error: "нет прав" });
    render(<AdminMailSettings />);
    const box = await screen.findByTestId("mail-notice-admin");
    fireEvent.click(within(box).getByRole("button", { name: "Включить" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("нет прав", "err"));
    expect(box).toHaveTextContent("Сейчас не показывается");
  });
});
