import { TASKS, taskById, type EgeTask, type Subject } from "../data/tasks";

/** Диагностика использует только задания с автоматической проверкой — без сочинений и без ИИ. */
function diagnosticPool(subject: Subject): EgeTask[] {
  return TASKS.filter((t) => t.subject === subject && t.answerType !== "essay");
}

/** Подбирает 8–12 заданий вперемешку по темам и сложности (раздел 3.1 ТЗ). */
export function pickDiagnosticTasks(subject: Subject, count = 10): EgeTask[] {
  const pool = diagnosticPool(subject);
  if (pool.length <= count) return pool;
  // равномерно берём по возрастанию сложности, чередуя темы
  const sorted = [...pool].sort((a, b) => a.difficulty - b.difficulty);
  const step = sorted.length / count;
  const picked: EgeTask[] = [];
  for (let i = 0; i < count; i++) picked.push(sorted[Math.floor(i * step)]);
  return picked;
}

export interface DiagnosticAnswer {
  taskId: string;
  given: string;
  correct: boolean;
  skipped: boolean;
}

export type DiagnosticLevel = "low" | "mid" | "high";

export interface DiagnosticResult {
  subject: Subject;
  finishedAt: number;
  answers: DiagnosticAnswer[];
  level: DiagnosticLevel;
  correctCount: number;
  totalCount: number;
  weakTopics: string[];
  strongTopics: string[];
  /** ориентировочный диапазон тестового балла — грубая эвристика, не гарантия (раздел 15.2 ТЗ) */
  estimatedScoreMin: number;
  estimatedScoreMax: number;
}

export function scoreDiagnostic(subject: Subject, answers: DiagnosticAnswer[]): DiagnosticResult {
  const correctCount = answers.filter((a) => a.correct).length;
  const totalCount = answers.length;
  const fraction = totalCount ? correctCount / totalCount : 0;

  const byTopic = new Map<string, { correct: number; total: number }>();
  for (const a of answers) {
    const task = taskById(a.taskId);
    if (!task) continue;
    const cell = byTopic.get(task.topic) ?? { correct: 0, total: 0 };
    cell.total++;
    if (a.correct) cell.correct++;
    byTopic.set(task.topic, cell);
  }
  const weakTopics: string[] = [];
  const strongTopics: string[] = [];
  for (const [topic, { correct, total }] of byTopic) {
    const acc = correct / total;
    if (acc < 0.5) weakTopics.push(topic);
    else if (acc === 1) strongTopics.push(topic);
  }

  const level: DiagnosticLevel = fraction < 0.4 ? "low" : fraction < 0.75 ? "mid" : "high";

  // грубая эвристика: порог ~27, дальше почти линейно к 100 с разбросом
  const center = 20 + fraction * 72;
  const spread = 6 + (1 - fraction) * 6;

  return {
    subject,
    finishedAt: Date.now(),
    answers,
    level,
    correctCount,
    totalCount,
    weakTopics,
    strongTopics,
    estimatedScoreMin: Math.max(0, Math.round(center - spread)),
    estimatedScoreMax: Math.min(100, Math.round(center + spread)),
  };
}

export const LEVEL_LABEL: Record<DiagnosticLevel, string> = {
  low: "начальный",
  mid: "средний",
  high: "уверенный",
};
