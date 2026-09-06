import type { Subject } from "../data/tasks";
import type { DiagnosticResult } from "./diagnostic";
import type { StudyPlan } from "./plan";
import { supabase, isSupabaseConfigured } from "./supabase";

// Ключ обязательно включает userId (свой и в гостевом режиме — см. GUEST_KEY/loadGuestProfile в
// lib/auth.tsx, там profile.id стабилен между перезагрузками) — раньше ключ был только по
// предмету, и на одном браузере диагностика/план предыдущего вошедшего аккаунта утекали
// следующему без выхода из системы (тот же класс бага, что уже чинили для попыток — см.
// userAttemptsKey в lib/store.tsx).
const diagKey = (subject: Subject, userId: string) => `ege-pro.diagnostic.${userId}.${subject}.v1`;
const planKey = (subject: Subject, userId: string) => `ege-pro.plan.${userId}.${subject}.v1`;

export function saveDiagnosticResult(result: DiagnosticResult, userId: string) {
  try {
    localStorage.setItem(diagKey(result.subject, userId), JSON.stringify(result));
  } catch {
    /* ignore */
  }
}

export function loadDiagnosticResult(subject: Subject, userId: string): DiagnosticResult | null {
  try {
    const raw = localStorage.getItem(diagKey(subject, userId));
    return raw ? (JSON.parse(raw) as DiagnosticResult) : null;
  } catch {
    return null;
  }
}

export function saveStudyPlan(plan: StudyPlan, userId: string) {
  try {
    localStorage.setItem(planKey(plan.subject, userId), JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

export function loadStudyPlan(subject: Subject, userId: string): StudyPlan | null {
  try {
    const raw = localStorage.getItem(planKey(subject, userId));
    return raw ? (JSON.parse(raw) as StudyPlan) : null;
  } catch {
    return null;
  }
}

/** Best-effort зеркалирование в Supabase (таблицы diagnostics/study_plans) — не блокирует UI. */
export function mirrorDiagnosticToSupabase(userId: string, result: DiagnosticResult) {
  if (!isSupabaseConfigured || !supabase) return;
  supabase
    .from("diagnostics")
    .insert({
      user_id: userId,
      subject: result.subject,
      finished_at: new Date(result.finishedAt).toISOString(),
      answers: result.answers,
      result: { level: result.level, weakTopics: result.weakTopics, strongTopics: result.strongTopics, estimatedScoreMin: result.estimatedScoreMin, estimatedScoreMax: result.estimatedScoreMax },
    })
    .then(({ error }) => {
      if (error) console.warn("Не удалось сохранить диагностику в Supabase:", error.message);
    });
}

export function mirrorPlanToSupabase(userId: string, plan: StudyPlan) {
  if (!isSupabaseConfigured || !supabase) return;
  supabase
    .from("study_plans")
    .insert({ user_id: userId, subject: plan.subject, generated_at: new Date(plan.generatedAt).toISOString(), items: plan })
    .then(({ error }) => {
      if (error) console.warn("Не удалось сохранить план в Supabase:", error.message);
    });
}
