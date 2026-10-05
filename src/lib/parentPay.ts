// «Попросить родителя оплатить» (docker/api/parentPay.js): у школьников часто нет своей карты, поэтому
// ученик отправляет родителю ссылку /pay-for/<токен>, а родитель без входа в аккаунт платит картой или
// через СБП. Здесь тонкие обёртки над API и тексты для отправки.
import { apiFetch } from "./supabase";

export type ShareChannel = "copy" | "whatsapp" | "telegram" | "email" | "other";
export type PayMethod = "card" | "sbp";

async function postJson(path: string, body: unknown) {
  const resp = await apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, json };
}

/** Ссылка для родителя (одна действующая на ученика). */
export async function createParentLink(): Promise<{ url?: string; error?: string }> {
  try {
    const { ok, json } = await postJson("/parent-link", {});
    return ok ? { url: json.url } : { error: json.error ?? "Не удалось создать ссылку" };
  } catch {
    return { error: "Нет связи с сервером — попробуй ещё раз" };
  }
}

/** Ученик поделился ссылкой — для статистики; ошибки не мешают пользователю. */
export function markParentLinkShared(channel: ShareChannel): void {
  postJson("/parent-link/shared", { channel }).catch(() => {});
}

export async function emailParent(email: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { ok, json } = await postJson("/parent-link/email", { email });
    return ok ? { ok: true } : { error: json.error ?? "Не удалось отправить письмо" };
  } catch {
    return { error: "Нет связи с сервером — попробуй ещё раз" };
  }
}

/** Текст сообщения родителю: коротко, понятно без контекста и с ссылкой. */
export function parentShareText(url: string, studentName?: string | null): string {
  const me = studentName ? `Это ${studentName}. ` : "";
  return `Привет! ${me}Я готовлюсь к ЕГЭ на ЕГЭ·ПРО — это тренажёр с ИИ-репетитором. Можешь оплатить мне тариф? По ссылке всё объяснено: можно картой или через СБП, оплата разовая, автопродления нет. ${url}`;
}

export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const telegramShareUrl = (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

export interface ParentTariff {
  id: string;
  name: string;
  badge: string | null;
  basePrice: number;
  finalPrice: number;
  subjectsCount: number;
  dailyAiLimit: number | null;
  features: string[];
}

export interface ParentPublicView {
  expired: boolean;
  studentName?: string | null;
  expiresAt?: string;
  currentTariffId?: string;
  tasksSolved?: number;
  diagnosticDone?: boolean;
  discountPercent?: number | null;
  discountUntil?: string | null;
  tariffs?: ParentTariff[];
}

export async function loadParentView(token: string): Promise<{ view?: ParentPublicView; notFound?: boolean; error?: string }> {
  try {
    const resp = await apiFetch(`/public/parent-link/${encodeURIComponent(token)}`);
    if (resp.status === 404) return { notFound: true };
    if (!resp.ok) return { error: "Не удалось загрузить страницу — обновите её через минуту" };
    return { view: (await resp.json()) as ParentPublicView };
  } catch {
    return { error: "Нет связи с сервером — обновите страницу" };
  }
}

export async function startParentPayment(token: string, p: { tariffId: string; email: string; method?: PayMethod }): Promise<{ confirmationUrl?: string; error?: string }> {
  try {
    const { ok, json } = await postJson(`/public/parent-link/${encodeURIComponent(token)}/pay`, p);
    return ok ? { confirmationUrl: json.confirmationUrl } : { error: json.error ?? "Не удалось создать платёж" };
  } catch {
    return { error: "Нет связи с сервером — попробуйте ещё раз" };
  }
}

export interface ParentPaymentStatus {
  status?: "pending" | "succeeded" | "canceled";
  amountRub?: number;
  tariffId?: string;
  studentName?: string | null;
  error?: string;
}

export async function getParentPaymentStatus(token: string, paymentId: string): Promise<ParentPaymentStatus> {
  try {
    const resp = await apiFetch(`/public/parent-link/${encodeURIComponent(token)}/payments/${encodeURIComponent(paymentId)}`);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) return { error: json.error ?? "Не удалось проверить оплату" };
    return json as ParentPaymentStatus;
  } catch {
    return { error: "Нет связи с сервером" };
  }
}

export const rub = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
