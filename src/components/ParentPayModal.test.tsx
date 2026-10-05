import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ParentPayModal from "./ParentPayModal";
import * as api from "../lib/parentPay";

const push = vi.fn();
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push }) }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { name: "Анна Петрова" } }) }));
vi.mock("../lib/metrika", () => ({ reachGoal: vi.fn() }));
vi.mock("../lib/parentPay", async (orig) => ({
  ...(await orig<typeof import("../lib/parentPay")>()),
  createParentLink: vi.fn(),
  emailParent: vi.fn(),
  markParentLinkShared: vi.fn(),
}));

const URL = "https://ege-tutor.ru/pay-for/abcdefghijklmnopqrstuvwx";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.createParentLink).mockResolvedValue({ url: URL });
  vi.mocked(api.emailParent).mockResolvedValue({ ok: true });
});

describe("ParentPayModal", () => {
  it("показывает сообщение родителю с именем ученика и ссылкой, WhatsApp и Telegram ведут на отправку этого текста", async () => {
    render(<ParentPayModal place="tariffs" onClose={vi.fn()} />);
    const text = await screen.findByTestId("parent-share-text");
    expect(text).toHaveTextContent("Это Анна.");
    expect(text).toHaveTextContent(URL);
    expect(text).toHaveTextContent("СБП");
    const wa = screen.getByRole("link", { name: "WhatsApp" });
    expect(wa.getAttribute("href")).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(wa.getAttribute("href")!)).toContain(URL);
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Telegram" }).getAttribute("href")).toContain("https://t.me/share/url?url=");
  });

  it("клик по WhatsApp и «Скопировать» отмечаются в статистике по каналам", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ParentPayModal place="tariffs" onClose={vi.fn()} />);
    await screen.findByTestId("parent-share-text");
    fireEvent.click(screen.getByRole("link", { name: "WhatsApp" }));
    expect(api.markParentLinkShared).toHaveBeenCalledWith("whatsapp");
    fireEvent.click(screen.getByRole("button", { name: /Скопировать/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(URL)));
    expect(api.markParentLinkShared).toHaveBeenCalledWith("copy");
    expect(push).toHaveBeenCalledWith(expect.stringContaining("скопировано"), "ok");
  });

  it("письмо родителю: отправка с адресом, подтверждение; ошибка сервера показывается и не закрывает окно", async () => {
    render(<ParentPayModal place="tariffs" onClose={vi.fn()} />);
    await screen.findByTestId("parent-share-text");
    const send = screen.getByRole("button", { name: "Отправить" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("mama@example.com"), { target: { value: " mama@mail.ru " } });
    vi.mocked(api.emailParent).mockResolvedValueOnce({ error: "Письмо родителю уже отправлено — подожди час" });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("подожди час");
    expect(api.emailParent).toHaveBeenCalledWith("mama@mail.ru");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Письмо отправлено");
  });

  it("не удалось создать ссылку — понятная ошибка вместо пустого окна", async () => {
    vi.mocked(api.createParentLink).mockResolvedValue({ error: "Нет связи с сервером — попробуй ещё раз" });
    render(<ParentPayModal place="tariffs" onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи с сервером");
    expect(screen.queryByRole("link", { name: "WhatsApp" })).not.toBeInTheDocument();
  });

  it("закрывается крестиком, но не кликом внутри окна", async () => {
    const onClose = vi.fn();
    render(<ParentPayModal place="tariffs" onClose={onClose} />);
    await screen.findByTestId("parent-share-text");
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("parentShareText", () => {
  it("без имени нет «Это …», ссылка в конце", () => {
    const t = api.parentShareText(URL, null);
    expect(t.startsWith("Привет! Я готовлюсь")).toBe(true);
    expect(t.endsWith(URL)).toBe(true);
  });
});
