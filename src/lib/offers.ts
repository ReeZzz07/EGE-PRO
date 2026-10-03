// Приветственный оффер — скидка на первую оплату с дедлайном (см. docker/api/offers.js: там же
// правила и настройки, а сама скидка при оплате всегда считается на сервере — эти данные нужны
// только чтобы честно показать цену и таймер).
import { useEffect, useState } from "react";
import { apiFetch, isSupabaseConfigured, supabase } from "./supabase";
import { useAuth } from "./auth";

export type OfferStepKey = "confirm" | "onboarding" | "diagnostic";

export interface OfferStep {
  key: OfferStepKey;
  percent: number;
  earned: boolean;
}

export interface WelcomeOffer {
  /** сколько уже заработано */
  percent: number;
  /** сколько будет после всех шагов */
  maxPercent: number;
  /** ISO-время окончания */
  expiresAt: string;
  steps: OfferStep[];
}

export async function loadWelcomeOffer(): Promise<WelcomeOffer | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await apiFetch("/offers/welcome");
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!(json?.active && typeof json.percent === "number" && json.expiresAt)) return null;
    const steps: OfferStep[] = Array.isArray(json.steps) ? json.steps : [];
    return { percent: json.percent, maxPercent: typeof json.maxPercent === "number" ? json.maxPercent : json.percent, expiresAt: json.expiresAt, steps };
  } catch {
    return null;
  }
}

/** Активный оффер текущего пользователя или null — сам гаснет по истечении, без перезагрузки. */
export function useWelcomeOffer(): WelcomeOffer | null {
  const { profile, isGuestMode } = useAuth();
  const userId = profile?.id;
  const [offer, setOffer] = useState<WelcomeOffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId || isGuestMode || profile?.isAdmin) {
      setOffer(null);
      return;
    }
    loadWelcomeOffer().then((o) => {
      if (!cancelled) setOffer(o);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isGuestMode, profile?.isAdmin]);

  useEffect(() => {
    if (!offer) return;
    const ms = new Date(offer.expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      setOffer(null);
      return;
    }
    const id = setTimeout(() => setOffer(null), Math.min(ms, 2_000_000_000));
    return () => clearTimeout(id);
  }, [offer]);

  return offer;
}

// ───────────── настройки оффера (админка → Тарифы) ─────────────

export interface WelcomeOfferSettings {
  enabled: boolean;
  hours: number;
  /** за подтверждение почты */
  confirmPercent: number;
  /** за онбординг */
  onboardingPercent: number;
  /** за диагностику */
  diagnosticPercent: number;
}

/** Держать синхронно с DEFAULT_WELCOME_OFFER в docker/api/offers.js */
export const DEFAULT_WELCOME_OFFER_SETTINGS: WelcomeOfferSettings = { enabled: true, hours: 120, confirmPercent: 10, onboardingPercent: 10, diagnosticPercent: 10 };

export const MAX_TOTAL_OFFER_PERCENT = 90;

const part = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TOTAL_OFFER_PERCENT ? v : null);

export async function loadWelcomeOfferSettings(): Promise<WelcomeOfferSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_WELCOME_OFFER_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "welcome_offer").maybeSingle();
  if (error || !data?.value) return DEFAULT_WELCOME_OFFER_SETTINGS;
  const v = data.value as Record<string, unknown>;
  const hours = typeof v.hours === "number" && Number.isInteger(v.hours) && v.hours >= 1 && v.hours <= 720 ? v.hours : DEFAULT_WELCOME_OFFER_SETTINGS.hours;
  let parts = [part(v.confirmPercent), part(v.onboardingPercent), part(v.diagnosticPercent)];
  if (parts.some((p) => p === null)) {
    // старый формат с единым percent — делим на три части, как на сервере (offers.js → sanitize)
    const legacy = typeof v.percent === "number" ? v.percent : NaN;
    if (Number.isInteger(legacy) && legacy >= 1 && legacy <= MAX_TOTAL_OFFER_PERCENT) {
      const third = Math.floor(legacy / 3);
      parts = [third, third, legacy - 2 * third];
    } else {
      parts = [DEFAULT_WELCOME_OFFER_SETTINGS.confirmPercent, DEFAULT_WELCOME_OFFER_SETTINGS.onboardingPercent, DEFAULT_WELCOME_OFFER_SETTINGS.diagnosticPercent];
    }
  }
  const total = (parts as number[]).reduce((a, b) => a + b, 0);
  if (total < 1 || total > MAX_TOTAL_OFFER_PERCENT) parts = [DEFAULT_WELCOME_OFFER_SETTINGS.confirmPercent, DEFAULT_WELCOME_OFFER_SETTINGS.onboardingPercent, DEFAULT_WELCOME_OFFER_SETTINGS.diagnosticPercent];
  return { enabled: v.enabled !== false, hours, confirmPercent: parts[0]!, onboardingPercent: parts[1]!, diagnosticPercent: parts[2]! };
}

export function validateWelcomeOfferSettings(s: WelcomeOfferSettings): string | null {
  for (const p of [s.confirmPercent, s.onboardingPercent, s.diagnosticPercent]) {
    if (!Number.isInteger(p) || p < 0) return "Каждая часть скидки — целое число процентов от 0.";
  }
  const total = s.confirmPercent + s.onboardingPercent + s.diagnosticPercent;
  if (total < 1 || total > MAX_TOTAL_OFFER_PERCENT) return `Суммарная скидка — от 1 до ${MAX_TOTAL_OFFER_PERCENT} %.`;
  if (!Number.isInteger(s.hours) || s.hours < 1 || s.hours > 720) return "Срок — целое число часов от 1 до 720 (30 дней).";
  return null;
}

export async function saveWelcomeOfferSettings(s: WelcomeOfferSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const invalid = validateWelcomeOfferSettings(s);
  if (invalid) return { error: invalid };
  const { error } = await supabase.from("app_settings").upsert({ key: "welcome_offer", value: s, updated_by: userId });
  return error ? { error: error.message } : {};
}
