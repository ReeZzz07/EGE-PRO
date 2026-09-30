// Общие правила валидации полей — вынесено отдельно, чтобы EMAIL_RE/normalizeEmail не разъезжались
// между /auth/signup, /auth/change-email (server.js) и правкой email админом (adminUsers.js
// updateUser) — раньше второй путь вообще не проверял формат, из-за чего админ мог молча сохранить
// битый email, и все последующие письма (в т.ч. подтверждение) уходили в никуда.

// Регистр и пробелы по краям — частая причина «потерянных» аккаунтов: "Ivan@Mail.ru " ≠ "ivan@mail.ru"
// при входе, а пробельный email вообще давал "No recipients defined" при отправке письма.
export const normalizeEmail = (raw) => String(raw ?? "").trim().toLowerCase();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MIN_PASSWORD_LENGTH = 6;
