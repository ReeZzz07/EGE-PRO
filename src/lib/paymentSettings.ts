// Настройка ЮKassa (shopId + секретный ключ) — хранится в public.app_settings, видна и
// редактируема только админом (RLS — см. supabase/migrations/0008_app_settings.sql), тот же
// паттерн, что у lib/aiSettings.ts. Читает её docker/api/yookassa.js на каждый платёж, так что
// сохранение здесь применяется сразу, без перезапуска контейнеров.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface YookassaSettings {
  shopId: string;
  secretKey: string;
}

export const DEFAULT_YOOKASSA_SETTINGS: YookassaSettings = { shopId: "", secretKey: "" };

export async function loadYookassaSettings(): Promise<YookassaSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_YOOKASSA_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "yookassa").maybeSingle();
  if (error || !data) return DEFAULT_YOOKASSA_SETTINGS;
  const v = data.value as Partial<YookassaSettings>;
  return { shopId: v.shopId ?? "", secretKey: v.secretKey ?? "" };
}

export async function saveYookassaSettings(settings: YookassaSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "yookassa", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}
