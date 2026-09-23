// Приветственный оффер — скидка на первую оплату с дедлайном (см. docker/api/offers.js: там же
// правила и настройки, а сама скидка при оплате всегда считается на сервере — эти данные нужны
// только чтобы честно показать цену и таймер).
import { useEffect, useState } from "react";
import { apiFetch, isSupabaseConfigured, supabase } from "./supabase";
import { useAuth } from "./auth";

export interface WelcomeOffer {
  percent: number;
  /** ISO-время окончания */
  expiresAt: string;
}

export async function loadWelcomeOffer(): Promise<WelcomeOffer | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await apiFetch("/offers/welcome");
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.active && typeof json.percent === "number" && json.expiresAt ? { percent: json.percent, expiresAt: json.expiresAt } : null;
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
  percent: number;
  hours: number;
}

/** Держать синхронно с DEFAULT_WELCOME_OFFER в docker/api/offers.js */
export const DEFAULT_WELCOME_OFFER_SETTINGS: WelcomeOfferSettings = { enabled: true, percent: 30, hours: 72 };

export async function loadWelcomeOfferSettings(): Promise<WelcomeOfferSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_WELCOME_OFFER_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "welcome_offer").maybeSingle();
  if (error || !data?.value) return DEFAULT_WELCOME_OFFER_SETTINGS;
  const v = data.value as Partial<WelcomeOfferSettings>;
  return {
    enabled: v.enabled !== false,
    percent: Number.isInteger(v.percent) && v.percent! >= 1 && v.percent! <= 90 ? v.percent! : DEFAULT_WELCOME_OFFER_SETTINGS.percent,
    hours: Number.isInteger(v.hours) && v.hours! >= 1 && v.hours! <= 720 ? v.hours! : DEFAULT_WELCOME_OFFER_SETTINGS.hours,
  };
}

export async function saveWelcomeOfferSettings(s: WelcomeOfferSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  if (!Number.isInteger(s.percent) || s.percent < 1 || s.percent > 90) return { error: "Скидка — целое число от 1 до 90 %." };
  if (!Number.isInteger(s.hours) || s.hours < 1 || s.hours > 720) return { error: "Срок — целое число часов от 1 до 720 (30 дней)." };
  const { error } = await supabase.from("app_settings").upsert({ key: "welcome_offer", value: s, updated_by: userId });
  return error ? { error: error.message } : {};
}
