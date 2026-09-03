// EssayView — на бесплатном тарифе проверка сочинений должна быть честно недоступна (не просто
// "спрятана", а с понятным объяснением и ссылкой на тарифы), а не молча пропадать или пытаться
// вызвать ИИ, который всё равно откажет (см. docker/api/server.js: isEssayCheckAllowed/tierBlocked,
// и docker/api/test/tariffGate.test.js — серверная сторона той же гарантии).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EssayView from "./EssayView";
import { useEssayCheckAllowed } from "../lib/tariffs";
import type { EgeTask } from "../data/tasks";

vi.mock("../lib/store", () => ({
  useProgress: () => ({ derived: { mistakeIds: new Set(), solvedIds: new Set() }, addAttempt: vi.fn() }),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ profile: { id: "u1", name: "Т", email: "t@t.local", isAdmin: false, tariffId: "free", subjects: [] }, isGuestMode: false }),
}));
vi.mock("../lib/tariffs", () => ({ useEssayCheckAllowed: vi.fn() }));
vi.mock("../lib/aiTutor", () => ({ callAiTutor: vi.fn() }));

const task: EgeTask = {
  id: "t1",
  fipiId: "27-1",
  subject: "rus",
  egeNumber: 27,
  topic: "Сочинение по прочитанному тексту",
  difficulty: 2,
  points: 25,
  statement: ["Прочитайте текст и напишите сочинение."],
  answers: [],
  answerNote: "развёрнутый ответ",
  explanation: [],
  hints: ["h1", "h2", "h3"],
  answerType: "essay",
  criteria: [{ code: "К1", name: "Формулировка проблемы", max: 1 }],
  minWords: 150,
};

describe("EssayView — гейт бесплатного тарифа", () => {
  it("essayAllowed=false — показывает пейволл с объяснением и кнопкой на тарифы, без формы ответа", () => {
    vi.mocked(useEssayCheckAllowed).mockReturnValue(false);
    render(<EssayView task={task} onNav={vi.fn()} nextTaskId="t2" />);

    expect(screen.getByText("Только на платных тарифах")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /смотреть тарифы/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Пиши здесь свой ответ…")).not.toBeInTheDocument();
  });

  it("essayAllowed=true — показывает форму ответа, без пейволла", () => {
    vi.mocked(useEssayCheckAllowed).mockReturnValue(true);
    render(<EssayView task={task} onNav={vi.fn()} nextTaskId="t2" />);

    expect(screen.getByPlaceholderText("Пиши здесь свой ответ…")).toBeInTheDocument();
    expect(screen.queryByText("Только на платных тарифах")).not.toBeInTheDocument();
  });

  it("essayAllowed=null (ещё грузится) — ни пейволл, ни форма не показаны раньше времени", () => {
    vi.mocked(useEssayCheckAllowed).mockReturnValue(null);
    render(<EssayView task={task} onNav={vi.fn()} nextTaskId="t2" />);

    expect(screen.queryByText("Только на платных тарифах")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Пиши здесь свой ответ…")).not.toBeInTheDocument();
  });
});
