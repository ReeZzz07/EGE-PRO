// Настройка провайдера ИИ-репетитора (Anthropic/Qwen) + ключ — хранится в public.app_settings,
// видна и редактируема только админом (RLS — см. supabase/migrations/0008_app_settings.sql).
// Читает её docker/api/server.js на каждый вызов /ai-tutor, так что сохранение здесь
// применяется сразу, без перезапуска контейнеров.
import { supabase, isSupabaseConfigured } from "./supabase";

export type AiProvider = "anthropic" | "qwen";

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { provider: "anthropic", apiKey: "", model: "", baseUrl: "" };

export async function loadAiSettings(): Promise<AiSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_AI_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "ai_provider").maybeSingle();
  if (error || !data) return DEFAULT_AI_SETTINGS;
  const v = data.value as Partial<AiSettings>;
  return { provider: v.provider === "qwen" ? "qwen" : "anthropic", apiKey: v.apiKey ?? "", model: v.model ?? "", baseUrl: v.baseUrl ?? "" };
}

export async function saveAiSettings(settings: AiSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "ai_provider", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}
