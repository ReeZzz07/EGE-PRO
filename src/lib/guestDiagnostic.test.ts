import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticResult } from "./diagnostic";
import {
  clearGuestDiagnostic,
  flushGuestDiagnosticToAccount,
  markGuestDiagSignupIntent,
  peekGuestDiagnostic,
  stashGuestDiagnostic,
  takeGuestDiagSignupIntent,
} from "./guestDiagnostic";

vi.mock("./planStorage", () => ({
  persistDiagnostic: vi.fn(),
}));

import { persistDiagnostic } from "./planStorage";

const sample = (over: Partial<DiagnosticResult> = {}): DiagnosticResult => ({
  subject: "math",
  finishedAt: 1_700_000_000_000,
  answers: [{ taskId: "t1", given: "1", correct: true, skipped: false }],
  level: "mid",
  correctCount: 1,
  totalCount: 1,
  weakTopics: [],
  strongTopics: ["Тема"],
  estimatedScoreMin: 40,
  estimatedScoreMax: 60,
  ...over,
});

afterEach(() => {
  clearGuestDiagnostic();
  vi.mocked(persistDiagnostic).mockClear();
});

describe("guestDiagnostic", () => {
  it("stash → peek → flush пишет в аккаунт и чистит stash", () => {
    stashGuestDiagnostic(sample());
    expect(peekGuestDiagnostic()?.subject).toBe("math");
    const flushed = flushGuestDiagnosticToAccount("user-1");
    expect(flushed?.correctCount).toBe(1);
    expect(persistDiagnostic).toHaveBeenCalledWith("user-1", expect.objectContaining({ subject: "math" }));
    expect(peekGuestDiagnostic()).toBeNull();
  });

  it("flush без stash — no-op", () => {
    expect(flushGuestDiagnosticToAccount("user-1")).toBeNull();
    expect(persistDiagnostic).not.toHaveBeenCalled();
  });

  it("signup intent переживает take один раз", () => {
    markGuestDiagSignupIntent("rus");
    expect(takeGuestDiagSignupIntent()).toEqual({ next: "onboarding", subject: "rus" });
    expect(takeGuestDiagSignupIntent()).toBeNull();
  });
});
