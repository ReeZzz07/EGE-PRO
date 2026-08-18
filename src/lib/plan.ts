import { TASKS, type EgeTask, type Subject } from "../data/tasks";
import type { DiagnosticResult } from "./diagnostic";
import { plural } from "./utils";

export interface PlanItem {
  type: "review-topic" | "train" | "mock" | "mistakes";
  label: string;
  taskIds: string[];
}

export interface StudyPlan {
  subject: Subject;
  generatedAt: number;
  today: PlanItem[];
  week: {
    trainingsPerWeek: number;
    mockExams: number;
    mistakeReview: boolean;
  };
  goalText: string;
}

function tasksForTopic(subject: Subject, topic: string, limit: number): EgeTask[] {
  return TASKS.filter((t) => t.subject === subject && t.topic === topic).slice(0, limit);
}

/** Эвристический план подготовки на основе результатов диагностики (раздел 3.2 ТЗ). Без ИИ — чистая логика. */
export function generatePlan(result: DiagnosticResult, dailyMinutes: number | undefined): StudyPlan {
  const { subject, weakTopics } = result;
  const today: PlanItem[] = [];

  const focusTopic = weakTopics[0];
  if (focusTopic) {
    const tasks = tasksForTopic(subject, focusTopic, 3);
    today.push({ type: "review-topic", label: `Повторить тему «${focusTopic}»`, taskIds: [] });
    if (tasks.length)
      today.push({ type: "train", label: `Решить ${tasks.length} ${plural(tasks.length, "задание", "задания", "заданий")} по теме «${focusTopic}»`, taskIds: tasks.map((t) => t.id) });
  } else {
    const anyTasks = TASKS.filter((t) => t.subject === subject && t.answerType !== "essay").slice(0, 3);
    today.push({ type: "train", label: "Закрепить формат: 3 задания на выбор", taskIds: anyTasks.map((t) => t.id) });
  }

  const minutes = dailyMinutes ?? 20;
  const trainingsPerWeek = minutes <= 10 ? 3 : minutes <= 30 ? 5 : 6;

  let goalText: string;
  if (weakTopics.length === 0) {
    goalText = "Закрепить результат и перейти к заданиям части 2.";
  } else if (weakTopics.length <= 2) {
    goalText = `Закрыть темы: ${weakTopics.join(", ")}.`;
  } else {
    goalText = `Постепенно закрыть слабые темы (начнём с «${weakTopics[0]}») и выйти на стабильный результат.`;
  }

  return {
    subject,
    generatedAt: Date.now(),
    today,
    week: {
      trainingsPerWeek,
      mockExams: 1,
      mistakeReview: weakTopics.length > 0,
    },
    goalText,
  };
}
