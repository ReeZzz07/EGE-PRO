// Состояние подписки ученика (см. docker/api/subscription.js — там же правила): действует ли платный
// тариф, доступные и «замороженные» после окончания срока предметы, что предложить для продления
// «как было» и для докупки предметов. Интерфейс рисуется по этому ответу и не считает цены сам.
import type { Subject } from "../data/tasks";
import { apiFetch, isSupabaseConfigured, supabase } from "./supabase";

export interface SubscriptionRenewal {
  tariffId: string;
  tariffName: string;
  extraSubjects: number;
  tariffPriceRub: number;
  addonsPriceRub: number;
  discountPercent: number | null;
  /** к оплате (уже со скидкой) */
  amountRub: number;
  periodDays: number;
}

export interface SubscriptionAddon {
  unitPriceRub: number;
  remainingDays: number;
  maxCount: number;
  discountPercent: number | null;
  /** quotes[i] — цена докупки (i + 1) предметов на оставшийся срок, уже со скидкой */
  quotes: number[];
}

export interface Subscription {
  isAdmin: boolean;
  tariffId: string;
  tariffName: string | null;
  paid: boolean;
  expiresAt: string | null;
  active: boolean;
  expired: boolean;
  daysLeft: number | null;
  extraSubjects: number;
  /** null — без ограничения (админ) */
  subjectsCap: number | null;
  activeSubjects: Subject[];
  frozenSubjects: Subject[];
  renewal: SubscriptionRenewal | null;
  addon: SubscriptionAddon | null;
}

export async function loadSubscription(): Promise<Subscription | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await apiFetch("/subscription");
    if (!resp.ok) return null;
    return (await resp.json()) as Subscription;
  } catch {
    return null;
  }
}

/** Тот же алгоритм, что splitSubjects на сервере: первые по порядку подключения остаются доступными. */
export function splitSubjects<T>(all: T[], cap: number | null | undefined): { active: T[]; frozen: T[] } {
  if (cap == null) return { active: all, frozen: [] };
  return { active: all.slice(0, cap), frozen: all.slice(cap) };
}

async function startPayment(path: string, body?: unknown): Promise<{ confirmationUrl?: string; error?: string }> {
  if (!isSupabaseConfigured) return { error: "Оплата недоступна в демо-режиме." };
  const resp = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: json.error ?? resp.statusText };
  return { confirmationUrl: json.confirmationUrl };
}

/** Продление тарифа с теми же настройками (тариф + докупленные предметы). */
export const startRenewalPayment = () => startPayment("/payments/renew");
/** Докупка count предметов к действующему тарифу. */
export const startAddonPayment = (count: number) => startPayment("/payments/addon", { count });

/** «Осталось N дней» с правильным склонением */
export function daysLabel(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  const word = abs > 10 && abs < 20 ? "дней" : d === 1 ? "день" : d >= 2 && d <= 4 ? "дня" : "дней";
  return `${n} ${word}`;
}

// ───────────── настройки докупки (админка → Тарифы) ─────────────

export interface AddonSettings {
  enabled: boolean;
  /** цена докупки одного предмета за 30 дней, ₽ */
  priceRub: number;
}

/** Держать синхронно с DEFAULT_ADDON_CONFIG в docker/api/subscription.js */
export const DEFAULT_ADDON_SETTINGS: AddonSettings = { enabled: true, priceRub: 1290 };

export async function loadAddonSettings(): Promise<AddonSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_ADDON_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "subject_addon").maybeSingle();
  if (error || !data?.value) return DEFAULT_ADDON_SETTINGS;
  const v = data.value as Partial<AddonSettings>;
  return {
    enabled: v.enabled !== false,
    priceRub: Number.isInteger(v.priceRub) && v.priceRub! >= 1 && v.priceRub! <= 100000 ? v.priceRub! : DEFAULT_ADDON_SETTINGS.priceRub,
  };
}

export async function saveAddonSettings(s: AddonSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  if (!Number.isInteger(s.priceRub) || s.priceRub < 1 || s.priceRub > 100000) return { error: "Цена — целое число рублей от 1 до 100 000." };
  const { error } = await supabase.from("app_settings").upsert({ key: "subject_addon", value: s, updated_by: userId });
  return error ? { error: error.message } : {};
}
