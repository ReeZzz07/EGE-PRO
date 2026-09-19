// Цели Метрики по ответам ИИ-репетитора (trackAiGoals): считаются только настоящие ответы сервера —
// не лимит, не блокировка экзамен-режима/тарифа и не пустой ответ.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./metrika", () => ({ reachGoal: vi.fn(), reachGoalOnce: vi.fn() }));
vi.mock("./supabase", () => ({ isSupabaseConfigured: false, supabase: null, apiFetch: vi.fn() }));

import { trackAiGoals } from "./aiTutor";
import { reachGoal, reachGoalOnce } from "./metrika";

const chat = { mode: "chat" as const };

describe("trackAiGoals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("обычный ответ — first_ai_use (раз на браузер), essay_check_used не шлётся", () => {
    trackAiGoals(chat, { offline: false, text: "Привет" });
    expect(reachGoalOnce).toHaveBeenCalledWith("first_ai_use", "first_ai_use");
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("проверка сочинения с оценкой — essay_check_used и first_ai_use", () => {
    trackAiGoals({ mode: "check_essay" }, { offline: false, assessment: { criteria: [], total: 1, max: 2, summary: "", improvementTips: [] } });
    expect(reachGoal).toHaveBeenCalledWith("essay_check_used");
    expect(reachGoalOnce).toHaveBeenCalledWith("first_ai_use", "first_ai_use");
  });

  it("дневной лимит — ai_limit_reached (ключ с датой: раз в день), first_ai_use не шлётся", () => {
    trackAiGoals(chat, { offline: false, text: "лимит", limitReached: true });
    const today = new Date().toISOString().slice(0, 10);
    expect(reachGoalOnce).toHaveBeenCalledTimes(1);
    expect(reachGoalOnce).toHaveBeenCalledWith(`ai_limit_reached:${today}`, "ai_limit_reached");
  });

  it("блокировка экзамен-режимом или тарифом — это не использование ИИ, ничего не шлётся", () => {
    trackAiGoals(chat, { offline: false, text: "нельзя", examBlocked: true });
    trackAiGoals({ mode: "check_essay" }, { offline: false, text: "платно", tierBlocked: true });
    expect(reachGoalOnce).not.toHaveBeenCalled();
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("пустой ответ — ничего не шлётся", () => {
    trackAiGoals(chat, { offline: false });
    expect(reachGoalOnce).not.toHaveBeenCalled();
  });
});
