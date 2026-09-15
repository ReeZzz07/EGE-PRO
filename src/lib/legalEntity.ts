// Реквизиты ИП (ИНН, ОГРНИП) — показываются в футере на каждой странице (см. Footer в App.tsx),
// редактируются в /admin → «Контент лендинга». Отдельный узкий загрузчик, не часть LandingContent
// (src/lib/content.ts): футер монтируется всегда, на каждой странице, а не только на лендинге, и
// не должен ради двух строк тянуть весь набор блоков лендинга (hero/capabilities/process/faq/ticker).
import { supabase, isSupabaseConfigured } from "./supabase";

export interface LegalEntityInfo {
  inn: string;
  ogrnip: string;
}

export const DEFAULT_LEGAL_ENTITY: LegalEntityInfo = { inn: "", ogrnip: "" };

export async function loadLegalEntityInfo(): Promise<LegalEntityInfo> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_LEGAL_ENTITY;
  const { data, error } = await supabase.from("content_blocks").select("data").eq("key", "legalEntity").maybeSingle();
  if (error || !data?.data) return DEFAULT_LEGAL_ENTITY;
  const v = data.data as Partial<LegalEntityInfo>;
  return { inn: v.inn ?? "", ogrnip: v.ogrnip ?? "" };
}

export async function saveLegalEntityInfo(info: LegalEntityInfo, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("content_blocks").upsert({ key: "legalEntity", data: info, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
