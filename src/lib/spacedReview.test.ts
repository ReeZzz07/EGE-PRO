// Интервальное повторение (раздел 3.4 ТЗ) — ошибка планирует повтор темы через растущие
// интервалы (1/3/7/14/30 дней), верный ответ двигает интервал дальше, но только когда повтор
// реально настал (иначе досрочная тренировка той же темы в банке сбивала бы расписание).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countScheduledTopics, getDueTopics, recordTopicOutcome, REVIEW_INTERVALS_DAYS } from "./spacedReview";

vi.mock("./supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

const DAY = 86_400_000;

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("recordTopicOutcome", () => {
  it("ошибка по новой теме — заводит расписание на первый (самый короткий) интервал", () => {
    const before = Date.now();
    recordTopicOutcome("u1", "rus", "Паронимы", false);
    const due = getDueTopics("u1", "rus"); // ещё не наступил срок — пусто
    expect(due).toEqual([]);
    expect(countScheduledTopics("u1")).toBe(1);
    // срок должен быть примерно через REVIEW_INTERVALS_DAYS[0] дней от момента ошибки
    vi.setSystemTime(before + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]);
  });

  it("верный ответ по теме БЕЗ заведённого расписания — ничего не создаёт", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", true);
    expect(countScheduledTopics("u1")).toBe(0);
  });

  it("верный ответ ДО срока повторения — расписание не двигается (не засчитывается)", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", false); // due через 1 день
    recordTopicOutcome("u1", "rus", "Паронимы", true); // прямо сейчас, срок ещё не настал
    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]); // всё ещё "к повторению" через 1 день, не через 3
  });

  it("верный ответ ПОСЛЕ срока — двигает на следующий интервал", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", false); // stage 0, due +1 день
    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]);

    recordTopicOutcome("u1", "rus", "Паронимы", true); // подтвердили — stage 1, due +3 дня от сейчас
    expect(getDueTopics("u1", "rus")).toEqual([]); // сразу после подтверждения снова не "к повторению"

    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[1] * DAY + 1000);
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]);
  });

  it("ошибка ПОСЛЕ прогресса откатывает обратно на первый интервал, а не удерживает прежний", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", false); // stage 0
    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);
    recordTopicOutcome("u1", "rus", "Паронимы", true); // stage 1 (due +3 дня)

    recordTopicOutcome("u1", "rus", "Паронимы", false); // снова ошибка — откат на stage 0
    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[1] * DAY + 1000); // будущее по СТАРОМУ (3-дневному) сроку
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]); // и так уже наступил (короче нового)
  });

  it("подтверждение последнего интервала — тема снимается с повторения (закреплена)", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", false); // stage 0
    let now = Date.now();
    for (let i = 0; i < REVIEW_INTERVALS_DAYS.length - 1; i++) {
      now += REVIEW_INTERVALS_DAYS[i] * DAY + 1000;
      vi.setSystemTime(now);
      recordTopicOutcome("u1", "rus", "Паронимы", true); // доходим до последнего stage
    }
    expect(countScheduledTopics("u1")).toBe(1); // ещё не закреплена — остался последний интервал
    now += REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1] * DAY + 1000;
    vi.setSystemTime(now);
    recordTopicOutcome("u1", "rus", "Паронимы", true); // подтвердили последний интервал
    expect(countScheduledTopics("u1")).toBe(0);
  });

  it("темы разных предметов/учеников не смешиваются", () => {
    recordTopicOutcome("u1", "rus", "Паронимы", false);
    recordTopicOutcome("u1", "math", "Логарифмы", false);
    recordTopicOutcome("u2", "rus", "Паронимы", false);
    vi.setSystemTime(Date.now() + REVIEW_INTERVALS_DAYS[0] * DAY + 1000);
    expect(getDueTopics("u1", "rus")).toEqual(["Паронимы"]);
    expect(getDueTopics("u1", "math")).toEqual(["Логарифмы"]);
    expect(countScheduledTopics("u1")).toBe(2);
    expect(countScheduledTopics("u2")).toBe(1);
  });
});
