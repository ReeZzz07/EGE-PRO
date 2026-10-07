// Куда уходит тестовое письмо из админки (раздел «Почта»): по умолчанию на почту самого админа, но можно указать
// любой другой адрес — например, ящик на Gmail или Mail.ru, чтобы посмотреть, как письмо выглядит и не попадает ли
// оно в спам. Адрес проверяется так же строго, как при регистрации (только латиница).
import { EMAIL_RE, emailProblem, normalizeEmail } from "./validators.js";

/** { to } — куда слать, или { error } — понятный текст для админа. Пусто — почта самого админа. */
export function resolveTestRecipient(raw, adminEmail) {
  const given = normalizeEmail(raw);
  if (!given) return { to: adminEmail };
  if (!EMAIL_RE.test(given)) return { error: emailProblem(given) };
  return { to: given };
}
