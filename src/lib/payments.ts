// Разовая оплата тарифа через ЮKassa — сама логика (создание платежа, вебхук, статус) на бэкенде
// (docker/api/payments.js), здесь только тонкие обёртки над apiFetch. См. миграцию
// 0024_payments.sql и PaymentReturnView.tsx (страница, куда ЮKassa возвращает после оплаты).
import { apiFetch, isSupabaseConfigured } from "./supabase";

export async function createPayment(tariffId: string): Promise<{ confirmationUrl?: string; error?: string }> {
  if (!isSupabaseConfigured) return { error: "Оплата недоступна в демо-режиме." };
  const resp = await apiFetch("/payments/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tariffId }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: json.error ?? resp.statusText };
  return { confirmationUrl: json.confirmationUrl };
}

export type PaymentStatus = "pending" | "succeeded" | "canceled";

export async function getPaymentStatus(paymentId: string): Promise<{ status?: PaymentStatus; error?: string }> {
  const resp = await apiFetch(`/payments/${encodeURIComponent(paymentId)}/status`);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: json.error ?? resp.statusText };
  return { status: json.status };
}
