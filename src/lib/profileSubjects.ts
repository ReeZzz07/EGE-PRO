// Список активных предметов ученика — public.profile_subjects (см.
// supabase/migrations/0014_profile_subjects.sql). До этой таблицы у профиля был только один
// primary_subject — тарифы обещают "N предметов на выбор", а выбрать второй было негде. Лимит по
// тарифу применяется в БД (триггер enforce_subject_limit), не только здесь — это лишь клиент.
import type { Subject } from "../data/tasks";
import { supabase, isSupabaseConfigured } from "./supabase";

export async function loadProfileSubjects(userId: string): Promise<Subject[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.from("profile_subjects").select("subject").eq("user_id", userId).order("added_at");
  if (error || !data) return [];
  return (data as { subject: Subject }[]).map((r) => r.subject);
}

export async function addProfileSubject(userId: string, subject: Subject): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("profile_subjects").insert({ user_id: userId, subject });
  if (error) {
    if (/лимит предметов/i.test(error.message)) return { error: "На текущем тарифе больше предметов не добавить — открой тариф с бо́льшим числом предметов." };
    if (/duplicate key|unique/i.test(error.message)) return { error: "Этот предмет уже добавлен." };
    return { error: error.message };
  }
  return {};
}

export async function removeProfileSubject(userId: string, subject: Subject): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("profile_subjects").delete().eq("user_id", userId).eq("subject", subject);
  return error ? { error: error.message } : {};
}
