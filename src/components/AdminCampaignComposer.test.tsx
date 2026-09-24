// Окно «Написать по фильтру»: число получателей и пример, защита «отправить можно только после подтверждения»,
// подтверждение точного числа, ошибка при изменении выборки, заготовки, тестовая отправка, ход рассылки.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCampaignComposer from "./AdminCampaignComposer";
import { EMPTY_USER_FILTERS, type AdminUserFilters } from "../lib/adminUsers";
import { createCampaign, loadCampaign, previewCampaign, renderCampaign, sendCampaignTest, type CampaignDetail } from "../lib/campaigns";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "admin-1", email: "admin@x.test" } }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));
vi.mock("../lib/campaigns", async (orig) => ({
  ...(await orig<typeof import("../lib/campaigns")>()),
  previewCampaign: vi.fn(),
  renderCampaign: vi.fn(),
  sendCampaignTest: vi.fn(),
  createCampaign: vi.fn(),
  loadCampaign: vi.fn(),
  cancelCampaign: vi.fn(),
}));

const filters: AdminUserFilters = { ...EMPTY_USER_FILTERS, funnel: { ...EMPTY_USER_FILTERS.funnel, confirmed: "yes", onboarded: "no" } };
const preview = (over = {}) => ({
  preview: {
    count: 12,
    overLimit: false,
    maxRecipients: 500,
    excludedRecent: 3,
    sample: [
      { id: "1", email: "anna@example.org", full_name: "Анна Иванова" },
      { id: "2", email: "boris@example.org", full_name: null },
    ],
    ...over,
  },
});
const detail = (over: Partial<CampaignDetail> = {}): CampaignDetail => ({
  id: "c1",
  created_at: "2026-09-24T10:00:00Z",
  finished_at: null,
  kind: "custom",
  subject: "s",
  status: "sending",
  total: 12,
  filters: {},
  q: null,
  exclude_recent: true,
  created_by_email: "admin@x.test",
  sent: 4,
  failed: 1,
  skipped: 0,
  pending: 7,
  problems: [{ email: "bad@example.org", status: "failed", error: "550 no mailbox" }],
  ...over,
});

const setup = (props: Partial<Parameters<typeof AdminCampaignComposer>[0]> = {}) => {
  const onApplyFilters = vi.fn();
  const onClose = vi.fn();
  render(<AdminCampaignComposer filters={filters} onApplyFilters={onApplyFilters} onClose={onClose} {...props} />);
  return { onApplyFilters, onClose };
};
const lastPreviewArg = (i: 0 | 1 | 2) => {
  const calls = vi.mocked(previewCampaign).mock.calls;
  return calls[calls.length - 1]?.[i];
};
const lastRenderKind = () => {
  const calls = vi.mocked(renderCampaign).mock.calls;
  return calls[calls.length - 1]?.[0];
};
const sendButton = () => screen.getByRole("button", { name: /Отправить \d+ письмам/ });
const ackBox = () => screen.getByRole("checkbox", { name: /Я проверил/ });

beforeEach(() => {
  vi.mocked(previewCampaign).mockReset().mockResolvedValue(preview());
  vi.mocked(renderCampaign).mockReset().mockResolvedValue({ subject: "Тема письма", html: "<p>письмо</p>" });
  vi.mocked(sendCampaignTest).mockReset().mockResolvedValue({});
  vi.mocked(createCampaign).mockReset().mockResolvedValue({ id: "c1", total: 12 });
  vi.mocked(loadCampaign).mockReset().mockResolvedValue(detail());
});

describe("AdminCampaignComposer", () => {
  it("заготовка подбирается по фильтру таблицы", async () => {
    const pick = async (funnel: Partial<AdminUserFilters["funnel"]>) => {
      const { unmount } = render(<AdminCampaignComposer filters={{ ...EMPTY_USER_FILTERS, funnel: { ...EMPTY_USER_FILTERS.funnel, ...funnel } }} onApplyFilters={vi.fn()} onClose={vi.fn()} />);
      const selected = (await screen.findAllByRole("tab")).find((t) => t.getAttribute("aria-selected") === "true")!.textContent;
      unmount();
      return selected;
    };
    expect(await pick({ confirmed: "no" })).toBe("Ссылка подтверждения почты");
    expect(await pick({ confirmed: "yes", onboarded: "no" })).toBe("Напоминание про онбординг");
    expect(await pick({ diagnostic: "no" })).toBe("Напоминание про диагностику");
    expect(await pick({})).toBe("Своё письмо");
  });

  it("показывает условия отбора, число получателей и пример; кнопка отправки заблокирована, пока не подтверждено", async () => {
    setup();
    expect(await screen.findByText("Анна Иванова")).toBeInTheDocument();
    expect(screen.getByTestId("recipients-count")).toHaveTextContent("12");
    expect(screen.getByText("Подтвердил аккаунт: да")).toBeInTheDocument();
    expect(screen.getByText("Прошёл онбординг: нет")).toBeInTheDocument();
    expect(screen.getByText(/исключено: 3/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    fireEvent.click(ackBox());
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it("отправка: уходит подтверждённое число получателей, вид, фильтры и текст; затем показывается ход рассылки", async () => {
    setup();
    await screen.findByText("Анна Иванова");
    // в списке «Куда ведёт кнопка» есть страница онбординга, и она выбрана для заготовки про анкету
    expect(screen.getByRole("option", { name: "Онбординг (анкета подготовки)" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Куда ведёт кнопка/)).toHaveValue("/onboarding");
    fireEvent.click(ackBox());
    fireEvent.click(sendButton());
    await waitFor(() => expect(createCampaign).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(createCampaign).mock.calls[0][0];
    expect(arg).toMatchObject({ kind: "custom", confirmCount: 12, excludeRecent: true });
    expect(arg.filters).toEqual(filters);
    expect(arg.content.subject).toMatch(/анкету|минута/i);
    expect(arg.content.ctaPath).toBe("/onboarding"); // письмо про анкету ведёт на страницу онбординга
    expect(await screen.findByText("Отправляется…")).toBeInTheDocument();
    expect(screen.getByText(/отправлено 4/)).toBeInTheDocument();
    expect(screen.getByText(/ошибок 1/)).toBeInTheDocument();
    expect(screen.getByText(/550 no mailbox/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
  });

  it("выборка изменилась (409): рассылка не создана, показано новое число, подтверждение сброшено", async () => {
    vi.mocked(createCampaign).mockResolvedValue({ error: "Число получателей изменилось: теперь 15.", code: "COUNT_MISMATCH", count: 15 });
    setup();
    await screen.findByText("Анна Иванова");
    fireEvent.click(ackBox());
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("теперь 15");
    expect(screen.getByTestId("recipients-count")).toHaveTextContent("15");
    expect(ackBox()).not.toBeChecked();
    expect(sendButton()).toBeDisabled();
  });

  it("сверх лимита или без получателей отправить нельзя", async () => {
    vi.mocked(previewCampaign).mockResolvedValue(preview({ count: 900, overLimit: true }));
    const { unmount } = render(<AdminCampaignComposer filters={filters} onApplyFilters={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/больше лимита 500/)).toBeInTheDocument();
    expect(ackBox()).toBeDisabled();
    unmount();

    vi.mocked(previewCampaign).mockResolvedValue(preview({ count: 0, sample: [] }));
    render(<AdminCampaignComposer filters={filters} onApplyFilters={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/получателей нет/)).toBeInTheDocument();
    expect(ackBox()).toBeDisabled();
  });

  it("заготовка «Ссылка подтверждения»: вид verify_link, без полей текста, есть кнопка применения фильтра", async () => {
    const { onApplyFilters } = setup();
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("tab", { name: "Ссылка подтверждения почты" }));
    await waitFor(() => expect(lastPreviewArg(0)).toBe("verify_link"));
    expect(screen.queryByLabelText(/Тема письма/)).not.toBeInTheDocument();
    expect(screen.getByText(/свежей ссылкой/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Применить фильтр" }));
    expect(onApplyFilters).toHaveBeenCalledWith(expect.objectContaining({ funnel: expect.objectContaining({ confirmed: "no" }) }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /Я проверил/ }));
    await waitFor(() => expect(sendButton()).toBeEnabled());
    fireEvent.click(sendButton());
    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(vi.mocked(createCampaign).mock.calls[0][0].kind).toBe("verify_link");
  });

  it("«Своё письмо» без темы и текста отправить нельзя; тестовое письмо уходит на почту админа", async () => {
    setup();
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("tab", { name: "Своё письмо" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Я проверил/ }));
    expect(sendButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Тема письма/), { target: { value: "Привет" } });
    fireEvent.change(screen.getByLabelText(/пустая строка — новый абзац/), { target: { value: "Текст {имя}" } });
    await waitFor(() => expect(renderCampaign).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("checkbox", { name: /Я проверил/ }));
    await waitFor(() => expect(sendButton()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /Тестовое на admin@x\.test/ }));
    await waitFor(() => expect(sendCampaignTest).toHaveBeenCalledWith("custom", expect.objectContaining({ subject: "Привет", bodyText: "Текст {имя}" })));
  });

  it("итоговый предпросмотр перед отправкой есть у обоих видов: для своего письма и для ссылки подтверждения", async () => {
    vi.mocked(renderCampaign).mockImplementation(async (kind) => ({ subject: kind === "verify_link" ? "Подтверди email — ЕГЭ·ПРО" : "Тема своего письма", html: kind === "verify_link" ? "<p>подтверди почту</p>" : "<p>своё письмо</p>" }));
    setup();
    const frame = () => screen.getByTitle("Итоговый предпросмотр письма") as HTMLIFrameElement;
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toBe("<p>своё письмо</p>"));
    expect(screen.getByTestId("final-preview")).toHaveTextContent("Тема своего письма");
    expect(screen.getByTestId("final-preview")).toHaveTextContent("12 чел.");
    expect(lastRenderKind()).toBe("custom");

    fireEvent.click(screen.getByRole("tab", { name: "Ссылка подтверждения почты" }));
    await waitFor(() => expect(frame().getAttribute("srcdoc")).toBe("<p>подтверди почту</p>"));
    expect(screen.getByTestId("final-preview")).toHaveTextContent("Подтверди email — ЕГЭ·ПРО");
    expect(lastRenderKind()).toBe("verify_link");

    fireEvent.click(screen.getByRole("button", { name: /Тестовое на admin@x\.test/ }));
    await waitFor(() => expect(sendCampaignTest).toHaveBeenCalledWith("verify_link", expect.anything()));
  });

  it("опция «не писать недавно получавшим» уходит на сервер", async () => {
    setup();
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("checkbox", { name: /Не писать тем, кому рассылка уже уходила/ }));
    await waitFor(() => expect(lastPreviewArg(2)).toBe(false));
  });
});
