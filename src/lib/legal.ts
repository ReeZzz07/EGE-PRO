// Публичная оферта и политика конфиденциальности — public.legal_documents (см.
// supabase/migrations/0012_legal_documents.sql). Публичное чтение (нужно гостям — ссылки ведут
// со страницы регистрации и со страницы тарифов, до входа в аккаунт), запись — только админ.
import { supabase, isSupabaseConfigured } from "./supabase";

export type LegalDocKey = "offer" | "privacy";

export interface LegalDoc {
  key: LegalDocKey;
  title: string;
  content: string;
  updatedAt: string | null;
}

export const LEGAL_DOC_LABELS: Record<LegalDocKey, string> = {
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
};

/** Фолбэк на случай отключённого бэкенда — короткая заглушка, а не полный текст (сам текст
 *  редактируется и хранится только в БД, дублировать его здесь незачем). */
const FALLBACK_DOCS: Record<LegalDocKey, LegalDoc> = {
  offer: { key: "offer", title: "Публичная оферта", content: "Бэкенд не подключён — документ пока недоступен. См. SETUP.md.", updatedAt: null },
  privacy: { key: "privacy", title: "Политика конфиденциальности", content: "Бэкенд не подключён — документ пока недоступен. См. SETUP.md.", updatedAt: null },
};

function fromRow(row: Record<string, unknown>): LegalDoc {
  return {
    key: row.key as LegalDocKey,
    title: row.title as string,
    content: row.content as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function loadLegalDoc(key: LegalDocKey): Promise<LegalDoc> {
  if (!isSupabaseConfigured || !supabase) return FALLBACK_DOCS[key];
  const { data, error } = await supabase.from("legal_documents").select("*").eq("key", key).maybeSingle();
  if (error || !data) return FALLBACK_DOCS[key];
  return fromRow(data as Record<string, unknown>);
}

export async function loadAllLegalDocs(): Promise<LegalDoc[]> {
  if (!isSupabaseConfigured || !supabase) return [FALLBACK_DOCS.offer, FALLBACK_DOCS.privacy];
  const { data, error } = await supabase.from("legal_documents").select("*").order("key");
  if (error || !data) return [FALLBACK_DOCS.offer, FALLBACK_DOCS.privacy];
  return (data as Record<string, unknown>[]).map(fromRow);
}

export async function saveLegalDoc(key: LegalDocKey, patch: { title: string; content: string }, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("legal_documents").update({ title: patch.title, content: patch.content, updated_by: userId }).eq("key", key);
  return error ? { error: error.message } : {};
}
