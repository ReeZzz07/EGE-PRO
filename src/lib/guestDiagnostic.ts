// Гостевая диагностика до регистрации: результат живёт в localStorage, после signup/login
// пишется в diagnostics через persistDiagnostic — так засчитывается шаг welcome offer.
import type { DiagnosticResult } from "./diagnostic";
import { persistDiagnostic } from "./planStorage";
import type { Subject } from "../data/tasks";

const KEY = "ege-pro.guest-diagnostic.v1";
const INTENT_KEY = "ege-pro.after-guest-diag.v1";

/** После гостевой диагностики → signup: куда вернуть (переживает вкладку verify-email). */
export function markGuestDiagSignupIntent(subject: Subject): void {
  try {
    localStorage.setItem(INTENT_KEY, JSON.stringify({ next: "onboarding", subject }));
  } catch {
    /* ignore */
  }
}

export function takeGuestDiagSignupIntent(): { next: "onboarding"; subject: Subject } | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    localStorage.removeItem(INTENT_KEY);
    const parsed = JSON.parse(raw) as { next?: string; subject?: Subject };
    if (parsed?.next === "onboarding" && parsed.subject) return { next: "onboarding", subject: parsed.subject };
    return null;
  } catch {
    return null;
  }
}

export function peekGuestDiagSignupIntent(): { next: "onboarding"; subject: Subject } | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { next?: string; subject?: Subject };
    if (parsed?.next === "onboarding" && parsed.subject) return { next: "onboarding", subject: parsed.subject };
    return null;
  } catch {
    return null;
  }
}

export function stashGuestDiagnostic(result: DiagnosticResult): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    /* ignore */
  }
}

export function peekGuestDiagnostic(): DiagnosticResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagnosticResult;
    if (!parsed?.subject || !Array.isArray(parsed.answers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGuestDiagnostic(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Забирает гостевой результат и пишет в аккаунт (БД + кэш). Идемпотентно по смыслу insert-истории. */
export function flushGuestDiagnosticToAccount(userId: string): DiagnosticResult | null {
  const result = peekGuestDiagnostic();
  if (!result) return null;
  clearGuestDiagnostic();
  persistDiagnostic(userId, result);
  return result;
}

export function guestDiagnosticSubject(): Subject | undefined {
  return peekGuestDiagnostic()?.subject;
}
