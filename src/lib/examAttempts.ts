// Сохранённые попытки "Экзамен-режима" (public.exam_attempts) — конкретный состав заданий одной
// пройденной сессии, чтобы его можно было найти в личном кабинете и пройти повторно (см.
// MockExam.tsx/StatsView.tsx). Отдельно от public.attempts (lib/store.tsx) — там след по каждому
// отдельному заданию для тетради ошибок/статистики, здесь — снимок набора заданий целиком.
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Subject } from "../data/tasks";

export interface ExamAttempt {
  id: number;
  subject: Subject;
  taskIds: string[];
  answers: Record<string, string>;
  primaryScore: number;
  maxPrimary: number;
  secondaryScore: number | null;
  secondaryMax: number | null;
  scaleYear: number | null;
  finishedAt: string;
}

interface ExamAttemptRow {
  id: number;
  subject: string;
  task_ids: string[];
  answers: Record<string, string>;
  primary_score: number;
  max_primary: number;
  secondary_score: number | null;
  secondary_max: number | null;
  scale_year: number | null;
  finished_at: string;
}

function toExamAttempt(row: ExamAttemptRow): ExamAttempt {
  return {
    id: row.id,
    subject: row.subject as Subject,
    taskIds: row.task_ids,
    answers: row.answers ?? {},
    primaryScore: row.primary_score,
    maxPrimary: row.max_primary,
    secondaryScore: row.secondary_score,
    secondaryMax: row.secondary_max,
    scaleYear: row.scale_year,
    finishedAt: row.finished_at,
  };
}

export async function saveExamAttempt(
  userId: string,
  data: {
    subject: Subject;
    taskIds: string[];
    answers: Record<string, string>;
    primaryScore: number;
    maxPrimary: number;
    secondaryScore?: number | null;
    secondaryMax?: number | null;
    scaleYear?: number | null;
  }
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return {};
  const { error } = await supabase.from("exam_attempts").insert({
    user_id: userId,
    subject: data.subject,
    task_ids: data.taskIds,
    answers: data.answers,
    primary_score: data.primaryScore,
    max_primary: data.maxPrimary,
    secondary_score: data.secondaryScore ?? null,
    secondary_max: data.secondaryMax ?? null,
    scale_year: data.scaleYear ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function listExamAttempts(subject?: Subject): Promise<ExamAttempt[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  let query = supabase.from("exam_attempts").select("*").order("finished_at", { ascending: false });
  if (subject) query = query.eq("subject", subject);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as ExamAttemptRow[]).map(toExamAttempt);
}

export async function getExamAttempt(id: number): Promise<ExamAttempt | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.from("exam_attempts").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toExamAttempt(data as ExamAttemptRow);
}

export async function deleteExamAttempt(id: number): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return {};
  const { error } = await supabase.from("exam_attempts").delete().eq("id", id);
  return error ? { error: error.message } : {};
}
