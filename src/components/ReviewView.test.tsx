import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReviewView from "./ReviewView";
import ReviewsSection from "./ReviewsSection";
import ReviewPrompt from "./ReviewPrompt";
import { saveMyReview, useMyReviewState, usePublicReviews, type MyReviewState, type PublicReviews } from "../lib/reviews";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "u1", isAdmin: false } }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));
vi.mock("../lib/reviews", async (orig) => ({
  ...(await orig<typeof import("../lib/reviews")>()),
  useMyReviewState: vi.fn(),
  usePublicReviews: vi.fn(),
  saveMyReview: vi.fn(),
  deleteMyReview: vi.fn(),
}));

const state = (over: Partial<MyReviewState["eligibility"]> = {}, review: MyReviewState["review"] = null): MyReviewState => ({
  eligibility: { eligible: true, onboarding: true, diagnostic: true, aiMessages: 5, required: 5, isAdmin: false, ...over },
  review,
  defaultName: "Анна К.",
  subjects: ["math"],
});
const hook = (s: MyReviewState | null) => vi.mocked(useMyReviewState).mockReturnValue({ state: s, loading: false, reload: vi.fn(async () => {}) });

beforeEach(() => {
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {}
});

describe("ReviewView", () => {
  it("условия не выполнены: вместо формы — прогресс 3 из 5, кнопки ведут к недостающим шагам", () => {
    hook(state({ eligible: false, onboarding: true, diagnostic: false, aiMessages: 3 }));
    const onNav = vi.fn();
    render(<ReviewView onNav={onNav} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Вопросы ИИ-репетитору: 3 из 5/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Перейти" })).toHaveLength(2); // онбординг уже пройден
    fireEvent.click(screen.getAllByRole("button", { name: "Перейти" })[0]!);
    expect(onNav).toHaveBeenCalledWith({ name: "diagnostic" });
  });

  it("допуск есть: форма с подписью по умолчанию; оценка 1–3 предупреждает, что отзыв не публикуется", () => {
    hook(state());
    render(<ReviewView onNav={vi.fn()} />);
    expect(screen.getByLabelText("как подписать")).toHaveValue("Анна К.");
    fireEvent.click(screen.getByRole("radio", { name: "2 из 5" }));
    expect(screen.getByText(/не публикуются/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "5 из 5" }));
    expect(screen.queryByText(/не публикуются/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });

  it("валидация: без оценки и с коротким текстом на сервер ничего не уходит", () => {
    hook(state());
    render(<ReviewView onNav={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Отправить отзыв" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Поставь оценку");
    fireEvent.click(screen.getByRole("radio", { name: "5 из 5" }));
    fireEvent.change(screen.getByLabelText("твой отзыв"), { target: { value: "коротко" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить отзыв" }));
    expect(screen.getByRole("alert")).toHaveTextContent("хотя бы 30");
    expect(saveMyReview).not.toHaveBeenCalled();
  });

  it("отправка: уходит оценка, текст, подпись и согласие", async () => {
    hook(state());
    vi.mocked(saveMyReview).mockResolvedValue({ review: undefined });
    render(<ReviewView onNav={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "5 из 5" }));
    const body = "Репетитор объясняет понятно, диагностика показала слабые темы.";
    fireEvent.change(screen.getByLabelText("твой отзыв"), { target: { value: body } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить отзыв" }));
    await waitFor(() => expect(saveMyReview).toHaveBeenCalledWith({ rating: 5, body, subject: null, displayName: "Анна К.", consentPublic: true }));
  });

  it("уже есть отзыв на модерации: статус виден, кнопка «Сохранить изменения» и «Удалить»", () => {
    hook(state({}, { rating: 5, body: "x".repeat(40), subject: null, displayName: "Анна К.", consentPublic: true, status: "pending", adminReply: null, createdAt: "", updatedAt: "t" }));
    render(<ReviewView onNav={vi.fn()} />);
    expect(screen.getByText("На модерации")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить изменения" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить отзыв" })).toBeInTheDocument();
  });
});

describe("ReviewPrompt", () => {
  it("показывается допущенному без отзыва, закрытие запоминается", () => {
    hook(state());
    const onOpen = vi.fn();
    const { unmount } = render(<ReviewPrompt variant="card" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Оставить отзыв" }));
    expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(screen.queryByRole("button", { name: "Оставить отзыв" })).not.toBeInTheDocument();
    unmount();
    render(<ReviewPrompt variant="card" onOpen={onOpen} />);
    expect(screen.queryByRole("button", { name: "Оставить отзыв" })).not.toBeInTheDocument();
  });

  it("условия не выполнены: карточка показывает прогресс, а не приглашение; полоска в чате скрыта", () => {
    hook(state({ eligible: false, onboarding: true, diagnostic: false, aiMessages: 2 }));
    const onOpen = vi.fn();
    const { container, rerender } = render(<ReviewPrompt variant="card" onOpen={onOpen} />);
    expect(screen.getByText(/Отзыв о сервисе откроется/)).toBeInTheDocument();
    expect(screen.getByText(/✓ онбординг/)).toBeInTheDocument();
    expect(screen.getByText(/○ диагностика/)).toBeInTheDocument();
    expect(screen.getByText(/○ репетитору 2\/5/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Оставить отзыв" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Подробнее" }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<ReviewPrompt variant="strip" onOpen={onOpen} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("не показывается, если отзыв уже есть или это админ", () => {
    hook(state({}, { rating: 5, body: "x".repeat(40), subject: null, displayName: "А", consentPublic: true, status: "approved", adminReply: null, createdAt: "", updatedAt: "" }));
    const { container, rerender } = render(<ReviewPrompt variant="card" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    hook(state({ eligible: false, isAdmin: true }));
    rerender(<ReviewPrompt variant="card" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReviewsSection", () => {
  const pub = (n: number): PublicReviews => ({
    count: n,
    average: 4.7,
    reviews: Array.from({ length: n }, (_, i) => ({ id: String(i), rating: 5, body: `Отзыв номер ${i}`, subject: "math", displayName: `Ученик ${i}`, adminReply: i === 0 ? "Спасибо!" : null, publishedAt: null })),
  });

  it("пока данных нет (меньше трёх отзывов) блок не рисуется", () => {
    vi.mocked(usePublicReviews).mockReturnValue(null);
    const { container } = render(<ReviewsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("рисует отзывы с подписью, предметом, средней оценкой и ответом команды", () => {
    vi.mocked(usePublicReviews).mockReturnValue(pub(3));
    render(<ReviewsSection />);
    expect(screen.getByText("Отзыв номер 1")).toBeInTheDocument();
    expect(screen.getByText("Ученик 2")).toBeInTheDocument();
    expect(screen.getAllByText(/Математика/)).toHaveLength(3);
    expect(screen.getByText(/4,7 · 3 отзыва/)).toBeInTheDocument();
    expect(screen.getByText(/Спасибо!/)).toBeInTheDocument();
  });
});
