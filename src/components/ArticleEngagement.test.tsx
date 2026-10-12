// Блок под статьёй: просмотры, лайки, репосты, комментарии. Гость читает и реагирует, но комментарий писать не может;
// вошедший пишет, а свои комментарии удаляет (админ — любые).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ArticleEngagement from "./ArticleEngagement";
import * as api from "../lib/blogEngagement";

const push = vi.fn();
let profile: { id: string; isAdmin?: boolean } | null = null;
vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push }) }));
vi.mock("../lib/blogEngagement", async (orig) => ({
  ...(await orig<typeof import("../lib/blogEngagement")>()),
  loadEngagement: vi.fn(),
  registerView: vi.fn(),
  toggleLike: vi.fn(),
  registerShare: vi.fn(),
  loadMoreComments: vi.fn(),
  postComment: vi.fn(),
  removeComment: vi.fn(),
}));

const STATS: api.EngagementStats = { views: 1234, likes: 5, shares: 2, comments: 2, liked: false };
const C1: api.BlogComment = { id: 11, author: "Мария", staff: false, body: "Спасибо, очень полезно", createdAt: "2026-10-07T10:00:00Z", mine: false };
const C2: api.BlogComment = { id: 10, author: "Редакция ЕГЭ·ПРО", staff: true, body: "Рады, что пригодилось", createdAt: "2026-10-07T09:00:00Z", mine: false };
const onNav = vi.fn();
const mount = (published = true) => render(<ArticleEngagement slug="kak-polzovatsya-podskazkami" title="Подсказки" published={published} onNav={onNav} />);
const stat = (label: string) => screen.getByTestId(`stat-${label}`).textContent?.replace(/\s/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  profile = null;
  vi.mocked(api.registerView).mockResolvedValue(STATS);
  vi.mocked(api.loadEngagement).mockResolvedValue({ stats: STATS, comments: [C1, C2], nextBeforeId: null });
});

describe("ArticleEngagement: показ", () => {
  it("четыре счётчика с подписями «Просмотры», «Лайки», «Репост в соцсети», «Комментарии» и список комментариев (у редакции — пометка)", async () => {
    mount();
    expect(await screen.findByText("Просмотры")).toBeInTheDocument();
    expect(stat("Просмотры")).toBe("1 234");
    expect(stat("Лайки")).toBe("5");
    expect(stat("Репост в соцсети")).toBe("2");
    expect(stat("Комментарии")).toBe("2");
    const items = screen.getAllByTestId("comment");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Мария")).toBeInTheDocument();
    expect(within(items[1]).getByText("редакция")).toBeInTheDocument();
  });

  it("просмотр засчитывается один раз при открытии, до чтения счётчиков", async () => {
    mount();
    await screen.findByText("Просмотры");
    expect(api.registerView).toHaveBeenCalledTimes(1);
    expect(api.registerView).toHaveBeenCalledWith("kak-polzovatsya-podskazkami");
    expect(vi.mocked(api.registerView).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.loadEngagement).mock.invocationCallOrder[0]);
  });

  it("черновик (не опубликован) — блока нет и запросов нет", async () => {
    const { container } = mount(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(api.registerView).not.toHaveBeenCalled();
    expect(api.loadEngagement).not.toHaveBeenCalled();
  });

  it("если сервер недоступен, статья читается как раньше — блок просто не появляется", async () => {
    vi.mocked(api.loadEngagement).mockResolvedValue(null);
    const { container } = mount();
    await waitFor(() => expect(api.loadEngagement).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ArticleEngagement: действия доступны всем", () => {
  it("лайк без входа: счётчик растёт сразу, повторный клик снимает; при ошибке возвращается прежнее число", async () => {
    vi.mocked(api.toggleLike).mockResolvedValueOnce({ liked: true, likes: 6 }).mockResolvedValueOnce({ liked: false, likes: 5 }).mockResolvedValueOnce({ error: "Нет связи с сервером" });
    mount();
    await screen.findByText("Просмотры");
    const btn = screen.getByRole("button", { name: "Поставить лайк" });
    fireEvent.click(btn);
    await waitFor(() => expect(stat("Лайки")).toBe("6"));
    expect(screen.getByRole("button", { name: "Убрать лайк" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Убрать лайк" }));
    await waitFor(() => expect(stat("Лайки")).toBe("5"));
    fireEvent.click(screen.getByRole("button", { name: "Поставить лайк" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("Нет связи с сервером", "err"));
    expect(stat("Лайки")).toBe("5");
  });

  it("репост в соцсеть: открывается ссылка с адресом статьи и название канала уходит на сервер; счётчик берётся с сервера", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(api.registerShare).mockResolvedValue({ ...STATS, shares: 3 });
    mount();
    await screen.findByText("Просмотры");
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
    await waitFor(() => expect(stat("Репост в соцсети")).toBe("3"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toContain("https://t.me/share/url?url=");
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain("/blog/kak-polzovatsya-podskazkami");
    expect(open.mock.calls[0][2]).toContain("noopener");
    expect(api.registerShare).toHaveBeenCalledWith("kak-polzovatsya-podskazkami", "telegram");
    open.mockRestore();
  });

  it("«Скопировать ссылку» копирует адрес и засчитывается отдельно (в «Репост в соцсети» не входит)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.registerShare).mockResolvedValue(STATS);
    mount();
    await screen.findByText("Просмотры");
    fireEvent.click(screen.getByRole("button", { name: /Скопировать ссылку/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/blog/kak-polzovatsya-podskazkami")));
    expect(api.registerShare).toHaveBeenCalledWith("kak-polzovatsya-podskazkami", "copy");
    expect(stat("Репост в соцсети")).toBe("2");
  });
});

describe("ArticleEngagement: комментарии", () => {
  it("гость видит приглашение войти вместо формы; кнопки ведут ко входу и регистрации", async () => {
    mount();
    await screen.findByText("Просмотры");
    expect(screen.queryByLabelText("Ваш комментарий")).not.toBeInTheDocument();
    expect(screen.getByText(/только зарегистрированные пользователи/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "auth", mode: "login" });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "auth", mode: "signup" });
    // читать комментарии гостю можно, а удалять — нет
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
  });

  it("вошедший пишет комментарий: он появляется сверху, счётчик растёт, поле очищается; кнопка недоступна для пустого текста", async () => {
    profile = { id: "u1" };
    const mine: api.BlogComment = { id: 12, author: "Анна", staff: false, body: "Новый комментарий", createdAt: "2026-10-07T11:00:00Z", mine: true };
    vi.mocked(api.postComment).mockResolvedValue({ comment: mine, stats: { ...STATS, comments: 3 } });
    mount();
    await screen.findByText("Просмотры");
    const send = screen.getByRole("button", { name: "Отправить" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: "Новый комментарий" } });
    fireEvent.click(send);
    await waitFor(() => expect(stat("Комментарии")).toBe("3"));
    expect(screen.getAllByTestId("comment")[0]).toHaveTextContent("Новый комментарий");
    expect(screen.getByLabelText("Ваш комментарий")).toHaveValue("");
    expect(api.postComment).toHaveBeenCalledWith("kak-polzovatsya-podskazkami", "Новый комментарий");
  });

  it("отказ сервера (фильтр, лимит) показывается текстом под формой, текст не теряется", async () => {
    profile = { id: "u1" };
    vi.mocked(api.postComment).mockResolvedValue({ error: "В комментарии нельзя оставлять контакты и ссылки. Уберите: ссылку." });
    mount();
    await screen.findByText("Просмотры");
    fireEvent.change(screen.getByLabelText("Ваш комментарий"), { target: { value: "смотри https://spam.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("нельзя оставлять контакты и ссылки");
    expect(screen.getByLabelText("Ваш комментарий")).toHaveValue("смотри https://spam.example");
  });

  it("«Удалить» есть только у своих комментариев; после подтверждения комментарий исчезает и счётчик уменьшается", async () => {
    profile = { id: "u1" };
    vi.mocked(api.loadEngagement).mockResolvedValue({ stats: STATS, comments: [{ ...C1, mine: true }, C2], nextBeforeId: null });
    vi.mocked(api.removeComment).mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    await screen.findByText("Просмотры");
    const buttons = screen.getAllByRole("button", { name: "Удалить" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getAllByTestId("comment")).toHaveLength(1));
    expect(api.removeComment).toHaveBeenCalledWith(11);
    expect(stat("Комментарии")).toBe("1");
  });

  it("админ видит «Удалить» у любых комментариев; если не подтвердил — ничего не удаляется", async () => {
    profile = { id: "admin", isAdmin: true };
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mount();
    await screen.findByText("Просмотры");
    const buttons = screen.getAllByRole("button", { name: "Удалить" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(api.removeComment).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("comment")).toHaveLength(2);
  });

  it("«Показать ещё» подгружает следующую страницу и пропадает, когда комментарии кончились", async () => {
    vi.mocked(api.loadEngagement).mockResolvedValue({ stats: { ...STATS, comments: 3 }, comments: [C1, C2], nextBeforeId: 10 });
    const older: api.BlogComment = { id: 9, author: "Олег", staff: false, body: "Старый комментарий", createdAt: "2026-10-06T10:00:00Z", mine: false };
    vi.mocked(api.loadMoreComments).mockResolvedValue({ comments: [older], nextBeforeId: null });
    mount();
    await screen.findByText("Просмотры");
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    await waitFor(() => expect(screen.getAllByTestId("comment")).toHaveLength(3));
    expect(api.loadMoreComments).toHaveBeenCalledWith("kak-polzovatsya-podskazkami", 10);
    expect(screen.queryByRole("button", { name: "Показать ещё" })).not.toBeInTheDocument();
  });
});
