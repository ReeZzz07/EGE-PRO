import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EarlyValueView, { consumeEarlyValueIntent, markEarlyValueIntent } from "./EarlyValueView";

vi.mock("../lib/dbTasks", () => ({
  useTasksVersion: () => 0,
  getAvailableSubjects: () => ["rus", "math"],
  hydrateDiagnosticTasks: () => Promise.resolve(),
  getDiagnosticPick: () => null,
}));

vi.mock("../lib/metrika", () => ({
  reachGoal: vi.fn(),
  reachGoalOnce: vi.fn(),
}));

vi.mock("../data/tasks", async () => {
  const actual = await vi.importActual<typeof import("../data/tasks")>("../data/tasks");
  return {
    ...actual,
    TASKS: [],
    SUBJECTS: {
      ...actual.SUBJECTS,
      rus: { ...actual.SUBJECTS.rus },
      math: { ...actual.SUBJECTS.math },
    },
  };
});

describe("EarlyValueView", () => {
  it("показывает выбор предмета", () => {
    render(<EarlyValueView onNav={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Попробуй одно задание/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Русский/i })).toBeInTheDocument();
  });

  it("mark/consume early-value intent", () => {
    sessionStorage.clear();
    expect(consumeEarlyValueIntent()).toBe(false);
    markEarlyValueIntent();
    expect(consumeEarlyValueIntent()).toBe(true);
    expect(consumeEarlyValueIntent()).toBe(false);
  });

  it("кнопка на главную", () => {
    const onNav = vi.fn();
    render(<EarlyValueView onNav={onNav} />);
    fireEvent.click(screen.getByRole("button", { name: /На главную/i }));
    expect(onNav).toHaveBeenCalledWith({ name: "landing" });
  });
});
