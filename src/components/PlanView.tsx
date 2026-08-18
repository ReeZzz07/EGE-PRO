import { useMemo } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { generatePlan } from "../lib/plan";
import { plural } from "../lib/utils";
import { loadDiagnosticResult, loadStudyPlan, saveStudyPlan, mirrorPlanToSupabase } from "../lib/planStorage";
import { useAuth } from "../lib/auth";
import { Icon, Reveal } from "./ui";

const SUBJECT_DATIVE: Record<Subject, string> = {
  math: "математике",
  rus: "русскому языку",
  inf: "информатике",
  fiz: "физике",
  soc: "обществознанию",
};

export default function PlanView({ subject, onStartTraining, onSkipToBank }: { subject: Subject; onStartTraining: (taskId: string) => void; onSkipToBank: () => void }) {
  const meta = SUBJECTS[subject];
  const { profile, isGuestMode } = useAuth();

  const { plan, result } = useMemo(() => {
    const diag = loadDiagnosticResult(subject);
    if (!diag) return { plan: null, result: null };
    let p = loadStudyPlan(subject);
    if (!p || p.generatedAt < diag.finishedAt) {
      p = generatePlan(diag, profile?.dailyMinutes);
      saveStudyPlan(p);
      if (!isGuestMode && profile) mirrorPlanToSupabase(profile.id, p);
    }
    return { plan: p, result: diag };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  if (!plan || !result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-display text-xl font-bold">План ещё не готов</p>
        <p className="mt-2 text-[13.5px] text-ink2">Сначала пройди короткую диагностику — на её основе строится план.</p>
        <button onClick={onSkipToBank} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">В банк заданий</button>
      </div>
    );
  }

  const firstTaskId = plan.today.find((i) => i.taskIds.length)?.taskIds[0];

  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <Reveal>
        <span className={`font-display inline-block border-2 border-ink px-2.5 py-1 text-[12px] font-black ${meta.color}`}>{meta.name}</span>
        <h1 className="font-display mt-4 text-2xl font-black">Твой план подготовки</h1>

        <div className="sheet mt-6 p-5 sm:p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">Сегодня</p>
          <ul className="mt-3 space-y-2.5">
            {plan.today.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed">
                <Icon name={item.type === "review-topic" ? "book" : "list"} size={16} className="mt-0.5 shrink-0 text-blue" />
                <span>{item.label}</span>
              </li>
            ))}
            <li className="flex items-start gap-2.5 text-[14px] leading-relaxed">
              <Icon name="chat" size={16} className="mt-0.5 shrink-0 text-blue" />
              <span>Получить первую подсказку от ИИ-репетитора, если понадобится</span>
            </li>
          </ul>
        </div>

        <div className="sheet mt-4 p-5 sm:p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-teal">На этой неделе</p>
          <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink/90">
            <li>• {plan.week.trainingsPerWeek} {plural(plan.week.trainingsPerWeek, "тренировка", "тренировки", "тренировок")} по {SUBJECT_DATIVE[subject]}</li>
            <li>• {plan.week.mockExams} мини-пробник</li>
            {plan.week.mistakeReview && <li>• Работа над ошибками из диагностики</li>}
          </ul>
        </div>

        <div className="sheet mt-4 p-5 sm:p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber">Цель</p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink/90">{plan.goalText}</p>
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          {firstTaskId ? (
            <button onClick={() => onStartTraining(firstTaskId)} className="btn btn-blue px-6 py-3 text-sm">
              Начать первую тренировку <Icon name="arrowR" size={16} />
            </button>
          ) : (
            <button onClick={onSkipToBank} className="btn btn-blue px-6 py-3 text-sm">
              В банк заданий <Icon name="arrowR" size={16} />
            </button>
          )}
        </div>
      </Reveal>
    </div>
  );
}
