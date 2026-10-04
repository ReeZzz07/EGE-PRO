import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContactsView from "./ContactsView";
import AdminFeedback from "./AdminFeedback";
import * as fb from "../lib/feedback";
import type { AdminFeedbackList } from "../lib/feedback";

const auth = vi.hoisted(() => ({ profile: null as null | { id: string; name: string; email: string }, isGuestMode: false }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/legalEntity", async (orig) => ({
  ...(await orig<typeof import("../lib/legalEntity")>()),
  loadLegalEntityInfo: vi.fn(async () => ({ inn: "123456789012", ogrnip: "3123", footerText: "" })),
}));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));
vi.mock("../lib/feedback", async (orig) => ({
  ...(await orig<typeof import("../lib/feedback")>()),
  useContactInfo: vi.fn(),
  sendFeedback: vi.fn(),
  loadMyFeedback: vi.fn(async () => []),
  loadAdminFeedback: vi.fn(),
  loadAdminFeedbackDetail: vi.fn(),
  updateAdminFeedback: vi.fn(),
  replyAdminFeedback: vi.fn(),
  loadContactSettings: vi.fn(),
  saveContactSettings: vi.fn(),
}));

const info = (channels: fb.ContactInfo["channels"] = []): fb.ContactInfo => ({ supportEmail: "support@ege-tutor.ru", replyWithinHours: 24, channels });

beforeEach(() => {
  vi.clearAllMocks();
  auth.profile = null;
  auth.isGuestMode = false;
  vi.mocked(fb.useContactInfo).mockReturnValue(info());
  vi.mocked(fb.loadMyFeedback).mockResolvedValue([]);
});

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ContactsView", () => {
  it("показывает почту поддержки, срок ответа и реквизиты; мессенджеры — только включённые", async () => {
    vi.mocked(fb.useContactInfo).mockReturnValue(info([{ id: "whatsapp", label: "WhatsApp", url: "https://wa.me/message/ABC" }]));
    render(<ContactsView onNav={vi.fn()} />);
    expect(screen.getByRole("link", { name: "support@ege-tutor.ru" })).toHaveAttribute("href", "mailto:support@ege-tutor.ru");
    expect(screen.getAllByText(/в течение одного дня/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/message/ABC");
    expect(screen.queryByRole("link", { name: "Telegram" })).not.toBeInTheDocument();
    expect(await screen.findByText(/ИНН 123456789012/)).toBeInTheDocument();
  });

  it("валидация на клиенте: тема, почта, короткий текст, согласие — на сервер ничего не уходит", () => {
    render(<ContactsView onNav={vi.fn()} />);
    const send = () => fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("Выбери тему");
    fill("тема", "payment");
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("корректную почту");
    fill("почта для ответа", "anya@mail.ru");
    fill("сообщение", "коротко");
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("хотя бы 10");
    fill("сообщение", "Не проходит оплата картой, пишет ошибку.");
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("согласие");
    expect(fb.sendFeedback).not.toHaveBeenCalled();
  });

  it("гость: отправка с темой, почтой и согласием → номер обращения; ловушка пустая", async () => {
    vi.mocked(fb.sendFeedback).mockResolvedValue({ id: 42 });
    render(<ContactsView onNav={vi.fn()} />);
    fill("тема", "payment");
    fill("имя", "Аня");
    fill("почта для ответа", "anya@mail.ru");
    fill("сообщение", "Не проходит оплата картой, пишет ошибку.");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(fb.sendFeedback).toHaveBeenCalled());
    const arg = vi.mocked(fb.sendFeedback).mock.calls[0]![0];
    expect(arg).toMatchObject({ topic: "payment", name: "Аня", email: "anya@mail.ru", consent: true, website: "" });
    expect(await screen.findByText("Обращение №42 принято")).toBeInTheDocument();
  });

  it("вошедший: почта и имя подставлены из аккаунта и не редактируются; приходят его прошлые обращения", async () => {
    auth.profile = { id: "u1", name: "Борис", email: "boris@mail.ru" };
    vi.mocked(fb.loadMyFeedback).mockResolvedValue([
      { id: 7, topic: "bug", message: "Не открывается страница", status: "answered", createdAt: new Date().toISOString(), replies: [{ text: "Починили!", at: new Date().toISOString() }] },
    ]);
    render(<ContactsView onNav={vi.fn()} />);
    expect(screen.getByLabelText("почта для ответа")).toHaveValue("boris@mail.ru");
    expect(screen.getByLabelText("почта для ответа")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("имя")).toHaveValue("Борис");
    expect(await screen.findByText(/№7 · Проблема с работой сайта/)).toBeInTheDocument();
    expect(screen.getByText("Отвечено")).toBeInTheDocument();
    expect(screen.getByText(/Починили!/)).toBeInTheDocument();
  });

  it("из задания: тема «Ошибка в задании» и номер задания приложены", async () => {
    vi.mocked(fb.sendFeedback).mockResolvedValue({ id: 5 });
    render(<ContactsView onNav={vi.fn()} topic="task_error" taskId="math-17" />);
    expect(screen.getByLabelText("тема")).toHaveValue("task_error");
    expect(screen.getByText("math-17")).toBeInTheDocument();
    fill("почта для ответа", "a@b.ru");
    fill("сообщение", "В условии опечатка в числе.");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(fb.sendFeedback).toHaveBeenCalled());
    expect(vi.mocked(fb.sendFeedback).mock.calls[0]![0]).toMatchObject({ topic: "task_error", taskId: "math-17" });
  });

  it("ошибка сервера (лимит) показывается и не теряет введённый текст", async () => {
    vi.mocked(fb.sendFeedback).mockResolvedValue({ error: "Слишком много обращений за час." });
    render(<ContactsView onNav={vi.fn()} />);
    fill("тема", "other");
    fill("почта для ответа", "a@b.ru");
    fill("сообщение", "Длинный вопрос про всё на свете.");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Слишком много обращений");
    expect(screen.getByLabelText("сообщение")).toHaveValue("Длинный вопрос про всё на свете.");
  });
});

describe("AdminFeedback", () => {
  const lastFilters = () => {
    const calls = vi.mocked(fb.loadAdminFeedback).mock.calls;
    return calls[calls.length - 1]![0];
  };
  const item = (over: Partial<fb.AdminFeedbackItem> = {}): fb.AdminFeedbackItem => ({
    id: 12, userId: null, email: "anya@mail.ru", name: "Аня", topic: "payment", message: "Не проходит оплата", taskId: null, source: "/tariffs", context: {},
    status: "new", adminNote: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), firstResponseAt: null, closedAt: null,
    teamNotified: "ok", teamNotifyError: null, ackSent: "failed", ackError: "SMTP", overdue: true, ...over,
  });
  const list = (items: fb.AdminFeedbackItem[]): AdminFeedbackList => ({ items, total: items.length, page: 1, pageSize: 20, counts: { new: items.length, in_progress: 0, answered: 0, closed: 0 }, overdue: items.length });

  it("список: статус, «просрочено», тема, автор, признак неотправленного письма; фильтр по статусу уходит на сервер", async () => {
    vi.mocked(fb.loadAdminFeedback).mockResolvedValue(list([item()]));
    render(<AdminFeedback />);
    expect(await screen.findByText("№12")).toBeInTheDocument();
    expect(screen.getAllByText("просрочено").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Оплата и тарифы").length).toBeGreaterThan(1); // в списке и в фильтре по теме
    expect(screen.getByTitle("Письмо команде / подтверждение автору")).toHaveTextContent("✓ ✗");
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "open" } });
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: "open" }));
    fireEvent.click(screen.getByRole("button", { name: /Сначала новые/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ dir: "asc" }));
    fireEvent.change(screen.getByLabelText("Сортировка"), { target: { value: "topic" } });
    await waitFor(() => expect(lastFilters()).toMatchObject({ sort: "topic" }));
  });

  it("карточка: история событий, ответ автору отправляется и показывается в истории", async () => {
    vi.mocked(fb.loadAdminFeedback).mockResolvedValue(list([item()]));
    const detail: fb.AdminFeedbackDetail = { ...item(), events: [{ id: 1, type: "created" as const, data: {} as Record<string, string>, createdAt: new Date().toISOString(), actor: null }, { id: 2, type: "ack_failed" as const, data: { error: "SMTP" }, createdAt: new Date().toISOString(), actor: null }] };
    vi.mocked(fb.loadAdminFeedbackDetail).mockResolvedValue(detail);
    vi.mocked(fb.replyAdminFeedback).mockResolvedValue({
      detail: { ...detail, status: "answered", events: [...detail.events, { id: 3, type: "reply_sent" as const, data: { text: "Проверили, всё работает." }, createdAt: new Date().toISOString(), actor: "admin@x.ru" }] },
    });
    render(<AdminFeedback />);
    fireEvent.click(await screen.findByRole("button", { name: /№12/ }));
    expect(await screen.findByText("Обращение создано")).toBeInTheDocument();
    expect(screen.getByText("Подтверждение автору НЕ отправилось")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Текст ответа"), { target: { value: "Проверили, всё работает." } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    await waitFor(() => expect(fb.replyAdminFeedback).toHaveBeenCalledWith(12, "Проверили, всё работает."));
    expect(await screen.findByText("Ответ отправлен автору")).toBeInTheDocument();
  });

  it("каналы: Telegram и VK подготовлены — включаются ссылкой, сохранение уходит на сервер", async () => {
    vi.mocked(fb.loadAdminFeedback).mockResolvedValue(list([]));
    const settings: fb.ContactSettings = { supportEmail: "support@ege-tutor.ru", channels: { whatsapp: { enabled: false, url: "" }, telegram: { enabled: false, url: "" }, vk: { enabled: false, url: "" } } };
    vi.mocked(fb.loadContactSettings).mockResolvedValue({
      settings,
      channels: [{ id: "whatsapp", label: "WhatsApp", hosts: ["wa.me"] }, { id: "telegram", label: "Telegram", hosts: ["t.me"] }, { id: "vk", label: "ВКонтакте", hosts: ["vk.com"] }],
    });
    vi.mocked(fb.saveContactSettings).mockImplementation(async (s) => ({ settings: s }));
    render(<AdminFeedback />);
    fireEvent.click(await screen.findByRole("tab", { name: "Контакты и каналы" }));
    expect(await screen.findByLabelText("Почта поддержки")).toHaveValue("support@ege-tutor.ru");
    fireEvent.click(screen.getByLabelText("Telegram"));
    fireEvent.change(screen.getByLabelText("Ссылка Telegram"), { target: { value: "https://t.me/egepro" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(fb.saveContactSettings).toHaveBeenCalled());
    expect(vi.mocked(fb.saveContactSettings).mock.calls[0]![0].channels.telegram).toEqual({ enabled: true, url: "https://t.me/egepro" });
  });
});
