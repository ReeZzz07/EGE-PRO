// Адрес для тестовых писем в админке (вкладка «Почта»): по умолчанию почта самого админа, но можно вписать любую —
// например, ящик на Gmail или Mail.ru, чтобы увидеть письмо глазами получателя. Адрес один на всю вкладку (поле
// наверху, кнопки в блоках ниже берут его отсюда) и запоминается в браузере. Сервер проверяет адрес сам
// (docker/api/testRecipient.js), здесь проверка нужна только чтобы не слать заведомо кривой запрос.
import { useSyncExternalStore } from "react";
import { isValidEmail } from "./validation";

const KEY = "ege-pro.test-email-to";

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

let value = read();
const listeners = new Set<() => void>();

export function setTestRecipient(next: string): void {
  value = next;
  try {
    if (next.trim()) localStorage.setItem(KEY, next.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно — адрес живёт до перезагрузки страницы */
  }
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** Что ввёл админ (сырой текст поля) — пусто означает «на мою почту». */
export function useTestRecipientInput(): string {
  return useSyncExternalStore(subscribe, () => value, () => "");
}

/** Итог для кнопок: куда реально уйдёт тест, и можно ли отправлять. to — undefined, когда шлём себе. */
export function useTestRecipient(ownEmail: string | undefined): { to: string | undefined; label: string; valid: boolean } {
  const raw = useTestRecipientInput().trim();
  if (!raw) return { to: undefined, label: ownEmail ?? "мою почту", valid: true };
  return { to: raw.toLowerCase(), label: raw, valid: isValidEmail(raw) };
}
