// Общие правила валидации полей форм — синхронизированы с тем, что уже проверяет бэкенд
// (EMAIL_RE/MIN_PASSWORD_LENGTH в docker/api/validators.js, age between 5 and 100 — CHECK-constraint
// на public.profiles, см. supabase/migrations/0027). Смысл дублирования на фронте не в замене
// серверной проверки (она остаётся последним словом), а в мгновенной обратной связи до отправки —
// без этого форма просто отправляла что угодно и узнавала о браке только после round-trip к серверу.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export const MIN_PASSWORD_LENGTH = 6;

export const MIN_AGE = 5;
export const MAX_AGE = 100;

export function isValidAge(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
}
