import type { Subject } from "../data/tasks";
import type { DiagnosticAnswer, DiagnosticLevel, DiagnosticResult } from "./diagnostic";
import type { StudyPlan } from "./plan";
import { supabase, isSupabaseConfigured } from "./supabase";

// Ключ обязательно включает userId (свой и в гостевом режиме — см. GUEST_KEY/loadGuestProfile в
// lib/auth.tsx). Источник истины для залогиненного пользователя — Postgres (diagnostics /
// study_plans); localStorage — кэш и офлайн. На логине hydrateProgressFromServer() подтягивает
// свежие строки с сервера в кэш, чтобы смена браузера/устройства не обнуляла план и диагностику.

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

function asDiagnosticResult(subject: Subject, finishedAt: string, answers: unknown, result: unknown): DiagnosticResult | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const level = r.level === "low" || r.level === "mid" || r.level === "high" ? (r.level as DiagnosticLevel) : null;
  if (!level) return null;
  const ans = Array.isArray(answers) ? (answers as DiagnosticAnswer[]) : [];
  return {
    subject,
    finishedAt: new Date(finishedAt).getTime() || Date.now(),
    answers: ans,
    level,
    correctCount: typeof r.correctCount === "number" ? r.correctCount : ans.filter((a) => a.correct).length,
    totalCount: typeof r.totalCount === "number" ? r.totalCount : ans.length,
    weakTopics: Array.isArray(r.weakTopics) ? (r.weakTopics as string[]) : [],
    strongTopics: Array.isArray(r.strongTopics) ? (r.strongTopics as string[]) : [],
    estimatedScoreMin: typeof r.estimatedScoreMin === "number" ? r.estimatedScoreMin : 0,
    estimatedScoreMax: typeof r.estimatedScoreMax === "number" ? r.estimatedScoreMax : 0,
  };
}

function asStudyPlan(subject: Subject, items: unknown, generatedAt: string): StudyPlan | null {
  if (!items || typeof items !== "object") return null;
  const p = items as Partial<StudyPlan>;
  if (!Array.isArray(p.today) || !p.week || typeof p.goalText !== "string") return null;
  return {
    subject,
    generatedAt: typeof p.generatedAt === "number" ? p.generatedAt : new Date(generatedAt).getTime() || Date.now(),
    today: p.today,
    week: p.week,
    goalText: p.goalText,
  };
}

/** Пишет диагностику в БД (история insert) и кэш. */
export function persistDiagnostic(userId: string, result: DiagnosticResult) {
  saveDiagnosticResult(result, userId);
  if (!isSupabaseConfigured || !supabase) return;
  supabase
    .from("diagnostics")
    .insert({
      user_id: userId,
      subject: result.subject,
      finished_at: new Date(result.finishedAt).toISOString(),
      answers: result.answers,
      result: {
        level: result.level,
        weakTopics: result.weakTopics,
        strongTopics: result.strongTopics,
        estimatedScoreMin: result.estimatedScoreMin,
        estimatedScoreMax: result.estimatedScoreMax,
        correctCount: result.correctCount,
        totalCount: result.totalCount,
      },
    })
    .then(({ error }) => {
      if (error) console.warn("Не удалось сохранить диагностику в БД:", error.message);
    });
}

/** @deprecated имя оставлено для старых вызовов — теперь это полный persist. */
export function mirrorDiagnosticToSupabase(userId: string, result: DiagnosticResult) {
  persistDiagnostic(userId, result);
}

/** Пишет план в БД (новая строка = актуальная версия) и кэш. */
export function persistPlan(userId: string, plan: StudyPlan) {
  saveStudyPlan(plan, userId);
  if (!isSupabaseConfigured || !supabase) return;
  supabase
    .from("study_plans")
    .insert({ user_id: userId, subject: plan.subject, generated_at: new Date(plan.generatedAt).toISOString(), items: plan })
    .then(({ error }) => {
      if (error) console.warn("Не удалось сохранить план в БД:", error.message);
    });
}

/** @deprecated имя оставлено для старых вызовов — теперь это полный persist. */
export function mirrorPlanToSupabase(userId: string, plan: StudyPlan) {
  persistPlan(userId, plan);
}

/**
 * Подтягивает с сервера последнюю диагностику и план по каждому предмету, у которого есть строки,
 * и кладёт в localStorage-кэш. Локальная копия выигрывает только если она новее (finishedAt /
 * generatedAt) — чтобы не затереть только что сохранённый результат до завершения insert.
 */
export async function hydratePlansFromServer(userId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  const [{ data: diags }, { data: plans }] = await Promise.all([
    supabase.from("diagnostics").select("subject, finished_at, answers, result").eq("user_id", userId).order("finished_at", { ascending: false }),
    supabase.from("study_plans").select("subject, generated_at, items").eq("user_id", userId).order("generated_at", { ascending: false }),
  ]);

  const seenDiag = new Set<string>();
  for (const row of diags ?? []) {
    const subject = row.subject as Subject;
    if (seenDiag.has(subject)) continue;
    seenDiag.add(subject);
    const remote = asDiagnosticResult(subject, row.finished_at as string, row.answers, row.result);
    if (!remote) continue;
    const local = loadDiagnosticResult(subject, userId);
    if (!local || local.finishedAt <= remote.finishedAt) saveDiagnosticResult(remote, userId);
  }

  const seenPlan = new Set<string>();
  for (const row of plans ?? []) {
    const subject = row.subject as Subject;
    if (seenPlan.has(subject)) continue;
    seenPlan.add(subject);
    const remote = asStudyPlan(subject, row.items, row.generated_at as string);
    if (!remote) continue;
    const local = loadStudyPlan(subject, userId);
    if (!local || local.generatedAt <= remote.generatedAt) saveStudyPlan(remote, userId);
  }
}
