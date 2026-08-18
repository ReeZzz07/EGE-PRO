import type { Subject } from "../data/tasks";
import type { DiagnosticResult } from "./diagnostic";
import type { StudyPlan } from "./plan";
import { supabase, isSupabaseConfigured } from "./supabase";

const diagKey = (subject: Subject) => `ege-pro.diagnostic.${subject}.v1`;
const planKey = (subject: Subject) => `ege-pro.plan.${subject}.v1`;

export function saveDiagnosticResult(result: DiagnosticResult) {
  try {
    localStorage.setItem(diagKey(result.subject), JSON.stringify(result));
  } catch {
    /* ignore */
  }
}

export function loadDiagnosticResult(subject: Subject): DiagnosticResult | null {
  try {
    const raw = localStorage.getItem(diagKey(subject));
    return raw ? (JSON.parse(raw) as DiagnosticResult) : null;
  } catch {
    return null;
  }
}

export function saveStudyPlan(plan: StudyPlan) {
  try {
    localStorage.setItem(planKey(plan.subject), JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

export function loadStudyPlan(subject: Subject): StudyPlan | null {
  try {
    const raw = localStorage.getItem(planKey(subject));
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
