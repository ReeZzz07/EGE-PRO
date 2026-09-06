// "Задание дня" на главной (Dashboard.tsx) — раньше на весь дашборд было одно задание, выбранное
// по дню из profile.primarySubject, независимо от того, сколько предметов реально подключено.
// Из-за рассинхронизации primarySubject/subjects (см. effectivePrimarySubject в lib/auth.tsx) это
// иногда показывало задание по предмету, который ученику вообще недоступен. Теперь — по одному
// заданию на каждый ПОДКЛЮЧЁННЫЙ предмет (см. Dashboard.tsx), и выбирается оно не просто ротацией
// по дню, а по приоритету: сначала действительно непройденная ошибка, потом задание по слабой теме
// из диагностики, и только если ни того ни другого нет — прежняя ротация по всему банку предмета.
import { TASKS, taskById, type EgeTask, type Subject } from "../data/tasks";
import { dayIndex } from "./utils";
import { loadDiagnosticResult } from "./planStorage";

/** Один случайный, но стабильный на весь день выбор из пула — тот же приём, что был у старого
 *  "задания дня" (см. git-историю Dashboard.tsx): ротация по номеру дня, а не Math.random(),
 *  чтобы задание не менялось от одной перезагрузки страницы к другой в течение дня. */
function pickOfDay<T>(pool: T[]): T | undefined {
  return pool.length ? pool[dayIndex(pool.length)] : undefined;
}

export function pickTaskOfDay(subject: Subject, mistakeIds: Set<string>, solvedIds: Set<string>, userId: string): EgeTask | undefined {
  const mistakes = [...mistakeIds].map((id) => taskById(id)).filter((t): t is EgeTask => !!t && t.subject === subject);
  const fromMistakes = pickOfDay(mistakes);
  if (fromMistakes) return fromMistakes;

  const weakTopics = loadDiagnosticResult(subject, userId)?.weakTopics ?? [];
  if (weakTopics.length) {
    const weakPool = TASKS.filter((t) => t.subject === subject && weakTopics.includes(t.topic) && !solvedIds.has(t.id));
    const fromWeakTopic = pickOfDay(weakPool);
    if (fromWeakTopic) return fromWeakTopic;
  }

  return pickOfDay(TASKS.filter((t) => t.subject === subject));
}
