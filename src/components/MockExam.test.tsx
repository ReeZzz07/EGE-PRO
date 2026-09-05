// MockExam — на бесплатном тарифе пробник не должен включать часть 2 (развёрнутый ответ), т.к.
// проверить её всё равно нельзя (см. docker/api/server.js: isEssayCheckAllowed). Экран настройки
// должен честно объяснить это, а не просто молча урезать пробник (см. EssayView.test.tsx — то же
// самое правило для отдельного экрана сочинения).
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MockExam from "./MockExam";
import { useEssayCheckAllowed } from "../lib/tariffs";
import { TASKS, type EgeTask } from "../data/tasks";

vi.mock("../lib/store", () => ({
  useProgress: () => ({ addAttempt: vi.fn() }),
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ profile: { id: "u1", name: "Т", email: "t@t.local", isAdmin: false, tariffId: "free", subjects: [] } }),
}));
vi.mock("../lib/tariffs", () => ({ useEssayCheckAllowed: vi.fn() }));
vi.mock("../lib/aiTutor", () => ({ callAiTutor: vi.fn() }));

function shortTask(id: string, egeNumber: number): EgeTask {
  return {
    id,
    fipiId: id,
    subject: "rus",
    egeNumber,
    topic: `Задание ${id}`,
    difficulty: 1,
    points: 1,
    statement: ["Условие"],
    answers: ["42"],
    answerNote: "",
    explanation: [],
    hints: ["h1", "h2", "h3"],
  };
}

function essayTask(): EgeTask {
  return {
    id: "essay-1",
    fipiId: "27",
    subject: "rus",
    egeNumber: 27,
    topic: "Сочинение",
    difficulty: 2,
    points: 25,
    statement: ["Напишите сочинение"],
    answers: [],
    answerNote: "",
    explanation: [],
    hints: ["h1", "h2", "h3"],
    answerType: "essay",
    criteria: [{ code: "К1", name: "Проблема", max: 1 }],
  };
}

beforeEach(() => {
  TASKS.length = 0;
  for (let i = 0; i < 6; i++) TASKS.push(shortTask(`s${i}`, i + 1));
  TASKS.push(essayTask());
});

afterEach(() => {
  TASKS.length = 0;
  cleanup();
});

describe("MockExam — экран настройки, гейт части 2 по тарифу", () => {
  it("essayAllowed=false — только часть 1, с честной припиской про платный тариф, без части 2", () => {
    vi.mocked(useEssayCheckAllowed).mockReturnValue(false);
    render(<MockExam subject="rus" onFinish={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText(/Часть 1: 6 заданий/)).toBeInTheDocument();
    expect(screen.queryByText(/Часть 2: 1 задание/)).not.toBeInTheDocument();
    expect(screen.getByText(/на платных тарифах/)).toBeInTheDocument();
  });

  it("essayAllowed=true — часть 1 и часть 2 обе включены, без пометки про тариф", () => {
    vi.mocked(useEssayCheckAllowed).mockReturnValue(true);
    render(<MockExam subject="rus" onFinish={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText(/Часть 1: 6 заданий/)).toBeInTheDocument();
    expect(screen.getByText(/Часть 2: 1 задание/)).toBeInTheDocument();
    expect(screen.queryByText(/на платных тарифах/)).not.toBeInTheDocument();
  });
});
