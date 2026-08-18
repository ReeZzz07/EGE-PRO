import { supabase, isSupabaseConfigured } from "./supabase";
import { taskById, type EgeTask, type Subject } from "../data/tasks";
import { getTutorReply, type TutorCtx } from "../data/tutor";

export type AiMode = "explain_topic" | "hint" | "check_essay" | "chat";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiTutorRequest {
  mode: AiMode;
  message?: string;
  taskId?: string;
  hintLevel?: number;
  essayText?: string;
  history?: ChatTurn[];
}

export interface EssayCriterionScore {
  code: string;
  name: string;
  max: number;
  score: number;
  comment: string;
}

export interface EssayAssessment {
  criteria: EssayCriterionScore[];
  total: number;
  max: number;
  summary: string;
  improvementTips: string[];
}

export interface AiTutorResponse {
  text?: string;
  actions?: string[];
  assessment?: EssayAssessment;
  /** true, если ответ сгенерирован локальным офлайн-fallback, а не настоящей LLM */
  offline: boolean;
}

/** Единая точка вызова ИИ-репетитора: настоящий edge function, если Supabase подключён, иначе честный офлайн-фолбэк. */
export async function callAiTutor(req: AiTutorRequest, ctx: { mistakeTasks: EgeTask[]; solvedCount: number; subject?: Subject }): Promise<AiTutorResponse> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.functions.invoke("ai-tutor", { body: req });
      if (error) throw error;
      return { offline: false, ...(data as Omit<AiTutorResponse, "offline">) };
    } catch (e) {
      console.warn("ai-tutor Edge Function недоступна, переключаюсь в офлайн-режим:", e);
    }
  }
  return offlineFallback(req, ctx);
}

function offlineFallback(req: AiTutorRequest, ctx: { mistakeTasks: EgeTask[]; solvedCount: number }): AiTutorResponse {
  if (req.mode === "check_essay") {
    const task = req.taskId ? taskById(req.taskId) : undefined;
    if (!task) return { offline: true, text: "Не нашёл задание для проверки." };
    return { offline: true, assessment: offlineEssayCheck(task, req.essayText ?? "") };
  }

  const task = req.taskId ? taskById(req.taskId) : undefined;
  const tutorCtx: TutorCtx = { task, hintLevel: req.hintLevel ?? 0, mistakeTasks: ctx.mistakeTasks, solvedCount: ctx.solvedCount };
  const reply = getTutorReply(req.message ?? (req.mode === "explain_topic" ? `объясни ${task?.topic ?? ""}` : "подсказка"), tutorCtx);
  return { offline: true, text: reply.text, actions: reply.actions };
}

function offlineEssayCheck(task: EgeTask, text: string): EssayAssessment {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const minWords = task.minWords ?? 80;
  const coverage = Math.min(1, words / minWords);
  const criteria: EssayCriterionScore[] = (task.criteria ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    max: c.max,
    score: Math.round(c.max * coverage * 0.6),
    comment:
      coverage < 1
        ? `Офлайн-режим: текст короче рекомендованного объёма (${words}/${minWords} слов) — содержание не анализируется.`
        : "Офлайн-режим: объём в норме, но содержательная проверка недоступна без подключённого ИИ.",
  }));
  const total = criteria.reduce((s, c) => s + c.score, 0);
  const max = criteria.reduce((s, c) => s + c.max, 0);
  return {
    criteria,
    total,
    max,
    summary:
      "Это офлайн-заглушка (Supabase и ИИ не подключены) — оценка приблизительная и учитывает только объём текста, а не содержание. Подключи бэкенд по SETUP.md, чтобы получить содержательную проверку по критериям от настоящей модели.",
    improvementTips: [
      "Подключи Supabase + секрет ANTHROPIC_API_KEY (см. SETUP.md) — тогда проверка станет содержательной.",
      words < minWords ? `Дострой ответ минимум до ${minWords} слов.` : "Объём достаточный — дальше важно содержание, которое офлайн-режим оценить не может.",
    ],
  };
}
