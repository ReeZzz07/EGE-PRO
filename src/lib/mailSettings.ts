// Настройка SMTP (сброс пароля, подтверждение email, чек об оплате) — public.app_settings, ключ
// 'smtp', тот же паттерн, что у lib/aiSettings.ts / lib/paymentSettings.ts. Читает docker/api/mailer.js
// на каждое письмо, так что сохранение здесь применяется сразу, без перезапуска контейнеров.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export const DEFAULT_SMTP_SETTINGS: SmtpSettings = {
  host: "",
  port: 465,
  secure: true,
  user: "",
  password: "",
  fromName: "ЕГЭ·ПРО",
  fromAddress: "",
};

export async function loadSmtpSettings(): Promise<SmtpSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_SMTP_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "smtp").maybeSingle();
  if (error || !data) return DEFAULT_SMTP_SETTINGS;
  const v = data.value as Partial<SmtpSettings>;
  return {
    host: v.host ?? "",
    port: v.port ?? 465,
    secure: v.secure ?? true,
    user: v.user ?? "",
    password: v.password ?? "",
    fromName: v.fromName ?? "ЕГЭ·ПРО",
    fromAddress: v.fromAddress ?? "",
  };
}

export async function saveSmtpSettings(settings: SmtpSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "smtp", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}
