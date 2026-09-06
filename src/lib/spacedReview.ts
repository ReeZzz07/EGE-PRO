// Интервальное повторение (раздел 3.4 ТЗ): "Если ученик допустил ошибку в определённой теме,
// платформа должна возвращать похожие задания через 1 день, 3 дня, неделю и т.д." — растущий
// интервал закрепляет знание в долгосрочной памяти, а не только в моменте решения.
//
// Источник истины — localStorage (тот же принцип, что у диагностики/плана, см. planStorage.ts:
// "DB — только зеркало, никогда не читается обратно"), ключ — по пользователю, как и там, чтобы на
// одном браузере расписание одного аккаунта не подмешивалось другому. public.topic_reviews
// (0021_topic_reviews.sql) — write-only зеркало для устойчивости данных, не читается обратно.
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Subject } from "../data/tasks";

/** Интервалы в днях между последовательными повторениями одной темы — растут с каждым удачным
 *  повторением "в срок"; ошибка (в любой момент) откатывает тему на самый короткий интервал. */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30];

export interface TopicReview {
  subject: Subject;
  topic: string;
  stage: number;
  dueAt: number; // epoch ms
}

const reviewsKey = (userId: string) => `ege-pro.topicReviews.${userId}.v1`;

function loadAll(userId: string): TopicReview[] {
  try {
    const raw = localStorage.getItem(reviewsKey(userId));
    return raw ? (JSON.parse(raw) as TopicReview[]) : [];
  } catch {
    return [];
  }
}

function saveAll(userId: string, reviews: TopicReview[]) {
  try {
    localStorage.setItem(reviewsKey(userId), JSON.stringify(reviews));
  } catch {
    /* ignore */
  }
}

function mirrorToSupabase(userId: string, review: TopicReview) {
  if (!isSupabaseConfigured || !supabase) return;
  supabase
    .from("topic_reviews")
    .upsert(
      { user_id: userId, subject: review.subject, topic: review.topic, stage: review.stage, due_at: new Date(review.dueAt).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "user_id,subject,topic" }
    )
    .then(({ error }) => {
      if (error) console.warn("Не удалось сохранить расписание повторения в Supabase:", error.message);
    });
}

/** Вызывается на КАЖДУЮ попытку решения задания (см. lib/store.tsx addAttempt) — обновляет
 *  расписание повторения темы этого задания:
 *  - ошибка — тема (пере)открывается на самый короткий интервал ({@link REVIEW_INTERVALS_DAYS}[0]),
 *    независимо от того, было ли расписание уже заведено раньше: раз ошибся сейчас — значит, по
 *    факту не знает сейчас, откатываем к началу цикла;
 *  - верный ответ засчитывается как пройденное повторение, только если тема была реально "к
 *    повторению" (её dueAt уже наступил) — иначе досрочная тренировка той же темы в банке не
 *    должна тасовать расписание, которое ещё не подошло;
 *  - верный ответ по теме без заведённого расписания вообще ничего не делает — раздел 3.4 явно
 *    привязывает создание расписания к факту ошибки, а не к первому же решению.
 *  - дойдя до конца цикла интервалов верным ответом — тема считается закреплённой и снимается с
 *    повторения (запись удаляется), а не крутится бесконечно на максимальном интервале. */
export function recordTopicOutcome(userId: string, subject: Subject, topic: string, correct: boolean): void {
  const all = loadAll(userId);
  const idx = all.findIndex((r) => r.subject === subject && r.topic === topic);

  if (!correct) {
    const next: TopicReview = { subject, topic, stage: 0, dueAt: Date.now() + REVIEW_INTERVALS_DAYS[0] * 86_400_000 };
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    saveAll(userId, all);
    mirrorToSupabase(userId, next);
    return;
  }

  if (idx < 0) return;
  const current = all[idx];
  if (current.dueAt > Date.now()) return;

  if (current.stage >= REVIEW_INTERVALS_DAYS.length - 1) {
    all.splice(idx, 1);
    saveAll(userId, all);
    if (isSupabaseConfigured && supabase) {
      supabase
        .from("topic_reviews")
        .delete()
        .eq("user_id", userId)
        .eq("subject", subject)
        .eq("topic", topic)
        .then(({ error }) => {
          if (error) console.warn("Не удалось убрать закреплённую тему из расписания в Supabase:", error.message);
        });
    }
    return;
  }

  const nextStage = current.stage + 1;
  const next: TopicReview = { subject, topic, stage: nextStage, dueAt: Date.now() + REVIEW_INTERVALS_DAYS[nextStage] * 86_400_000 };
  all[idx] = next;
  saveAll(userId, all);
  mirrorToSupabase(userId, next);
}

/** Темы предмета, чей срок повторения уже наступил — то, что реально нужно показать ученику
 *  сегодня (см. pickTaskOfDay в lib/taskOfDay.ts). */
export function getDueTopics(userId: string, subject: Subject): string[] {
  const now = Date.now();
  return loadAll(userId)
    .filter((r) => r.subject === subject && r.dueAt <= now)
    .map((r) => r.topic);
}

/** Сколько тем сейчас в цикле повторения (просроченных и будущих) — для сводки в Статистике. */
export function countScheduledTopics(userId: string): number {
  return loadAll(userId).length;
}
