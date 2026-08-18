import { useMemo } from "react";
import { taskById } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { loadStudyPlan } from "../lib/planStorage";
import { dateKey, plural } from "../lib/utils";
import { Icon, Reveal } from "./ui";
import type { View } from "./Header";

export default function SessionSummary({ onNav }: { onNav: (v: View) => void }) {
  const { derived } = useProgress();
  const { profile } = useAuth();

  const todayAttempts = useMemo(() => derived.attempts.filter((a) => dateKey(a.ts) === dateKey(Date.now())), [derived.attempts]);
  const topics = new Set(todayAttempts.map((a) => taskById(a.taskId)?.topic).filter(Boolean) as string[]);
  const correctCount = todayAttempts.filter((a) => a.correct).length;
  const mistakesReviewed = new Set(todayAttempts.filter((a) => !a.correct).map((a) => a.taskId)).size;

  const plan = profile?.primarySubject ? loadStudyPlan(profile.primarySubject) : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Reveal>
        <span className="flex h-12 w-12 items-center justify-center border-2 border-ink bg-hl text-ink">
          <Icon name="check" size={22} />
        </span>
        <h1 className="font-display mt-4 text-2xl font-black">Итог сессии</h1>

        {todayAttempts.length === 0 ? (
          <p className="mt-3 text-[14px] leading-relaxed text-ink2">Сегодня ты ещё ничего не решил(а). Загляни в банк заданий — даже одно задание сдвинет дело с места.</p>
        ) : (
          <p className="mt-3 text-[14px] leading-relaxed text-ink2">
            Сегодня ты прошёл(а) <strong className="text-ink">{todayAttempts.length}</strong> {plural(todayAttempts.length, "задание", "задания", "заданий")}
            {mistakesReviewed > 0 && <> и разобрал(а) <strong className="text-ink">{mistakesReviewed}</strong> {plural(mistakesReviewed, "ошибку", "ошибки", "ошибок")}</>}. Хорошее начало.
          </p>
        )}

        {topics.size > 0 && (
          <div className="sheet mt-5 p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Темы сегодня</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...topics].map((t) => <span key={t} className="border border-ink/20 px-2.5 py-1 text-[12.5px] font-semibold text-ink/80">{t}</span>)}
            </div>
            <p className="mt-3 font-mono text-[12px] text-ink2">Верно: {correctCount} из {todayAttempts.length}</p>
          </div>
        )}

        <div className="sheet mt-4 p-5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-blue">План на завтра</p>
          {plan ? (
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              {plan.today[0]?.label ?? "Продолжи тренировки по плану"} — примерно {profile?.dailyMinutes ?? 20} минут.
            </p>
          ) : (
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">Пройди диагностику, чтобы получить персональный план на каждый день.</p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={() => onNav({ name: "bank" })} className="btn btn-blue px-6 py-3 text-sm">Продолжить <Icon name="arrowR" size={16} /></button>
          {plan && (
            <button onClick={() => onNav({ name: "plan" })} className="btn btn-ghost px-5 py-3 text-sm">Посмотреть план</button>
          )}
          <button onClick={() => onNav({ name: "home" })} className="btn btn-ghost px-5 py-3 text-sm">Завершить</button>
        </div>
      </Reveal>
    </div>
  );
}
