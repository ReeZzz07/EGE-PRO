import { useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { useAuth, type Goal, type Grade } from "../lib/auth";
import { useTasksVersion } from "../lib/dbTasks";
import { Icon, Reveal } from "./ui";
import AuthScreen from "./AuthScreen";
import type { View } from "./Header";

type Step = "subject" | "quiz" | "auth" | "explainer";

const GRADE_OPTS: { v: Grade; l: string }[] = [
  { v: "10", l: "10 класс" },
  { v: "11", l: "11 класс" },
  { v: "grad", l: "Выпускник прошлых лет" },
];
const YEAR_OPTS: { v: "this" | "next"; l: string }[] = [
  { v: "this", l: "В этом году" },
  { v: "next", l: "В следующем году" },
];
const GOAL_OPTS: { v: Goal; l: string }[] = [
  { v: "threshold", l: "Перейти порог" },
  { v: "70plus", l: "Сдать на 70+" },
  { v: "80plus", l: "Сдать на 80+" },
  { v: "olympiad", l: "Готовлюсь к олимпиаде / топ-вузу" },
];
const TIME_OPTS: { v: number; l: string }[] = [
  { v: 10, l: "10 минут в день" },
  { v: 25, l: "20–30 минут в день" },
  { v: 60, l: "1 час в день" },
  { v: 90, l: "Больше часа" },
];

function ChoiceRow<T extends string | number>({ label, options, value, onChange }: { label: string; options: { v: T; l: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.v)}
            onClick={() => onChange(o.v)}
            className={`border-2 px-3.5 py-2 text-[13px] font-bold transition ${value === o.v ? "border-blue bg-blue text-white" : "border-ink/20 text-ink2 hover:border-ink/50 hover:text-ink"}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingFlow({
  initialSubject,
  onFinishToDiagnostic,
  onFinishToBank,
  onNav,
}: {
  initialSubject?: Subject;
  onFinishToDiagnostic: (subject: Subject) => void;
  onFinishToBank: () => void;
  onNav: (v: View) => void;
}) {
  const { profile, updateProfile } = useAuth();
  useTasksVersion();
  const [step, setStep] = useState<Step>(initialSubject ? "quiz" : "subject");
  const [subject, setSubject] = useState<Subject | undefined>(initialSubject);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [year, setYear] = useState<"this" | "next" | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);

  const quizComplete = !!(grade && year && goal && minutes);

  const finalizeAndGo = (dest: "diagnostic" | "bank") => {
    const examYear = new Date().getFullYear() + (year === "next" ? 1 : 0);
    updateProfile({ grade: grade!, examYear, goal: goal!, dailyMinutes: minutes!, primarySubject: subject!, onboardedAt: Date.now() });
    if (dest === "diagnostic") onFinishToDiagnostic(subject!);
    else onFinishToBank();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* прогресс шагов */}
      <div className="mb-8 flex items-center gap-1.5">
        {(["subject", "quiz", "auth", "explainer"] as Step[]).map((s, i) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${(["subject", "quiz", "auth", "explainer"] as Step[]).indexOf(step) >= i ? "bg-blue" : "bg-ink/10"}`} />
        ))}
      </div>

      {step === "subject" && (
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 1 из 4</p>
          <h1 className="font-display mt-1 text-2xl font-black">Какая математика тебе нужна?</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
            Русский язык и математику — обязательные для всех экзамены — мы уже подключили. Осталось выбрать уровень
            математики: профильная нужна для поступления на специальности, где она в списке вступительных; базовая —
            если она там не понадобится.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {(["math_base", "math"] as const).map((id) => {
              const s = SUBJECTS[id];
              return (
                <button
                  key={id}
                  onClick={() => { setSubject(id); setStep("quiz"); }}
                  className="sheet card-lift flex items-start gap-3 p-4 text-left"
                >
                  <span className={`font-display flex h-10 w-10 shrink-0 items-center justify-center border-2 border-ink text-[12px] font-black ${s.color}`}>{s.short}</span>
                  <span>
                    <span className="block text-[14px] font-bold">{id === "math_base" ? "Базовая" : "Профильная"}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink2">{s.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Reveal>
      )}

      {step === "quiz" && subject && (
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 2 из 4</p>
          <h1 className="font-display mt-1 text-2xl font-black">Расскажи о своей цели</h1>
          <p className="mt-1.5 text-[13px] text-ink2">Предмет: <strong className={SUBJECTS[subject].color}>{SUBJECTS[subject].name}</strong></p>
          <div className="sheet mt-6 space-y-5 p-5 sm:p-6">
            <ChoiceRow label="В каком классе ты сейчас?" options={GRADE_OPTS} value={grade} onChange={setGrade} />
            <ChoiceRow label="Когда планируешь сдавать ЕГЭ?" options={YEAR_OPTS} value={year} onChange={setYear} />
            <ChoiceRow label="Какая цель?" options={GOAL_OPTS} value={goal} onChange={setGoal} />
            <ChoiceRow label="Сколько времени готов уделять?" options={TIME_OPTS} value={minutes} onChange={setMinutes} />
          </div>
          <button
            disabled={!quizComplete}
            onClick={() => setStep(profile ? "explainer" : "auth")}
            className="btn btn-blue mt-6 px-6 py-3 text-sm"
          >
            Далее <Icon name="arrowR" size={16} />
          </button>
        </Reveal>
      )}

      {step === "auth" && (
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 3 из 4</p>
          <AuthScreen compact onSuccess={() => setStep("explainer")} onNav={onNav} />
        </Reveal>
      )}

      {step === "explainer" && subject && (
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 4 из 4</p>
          <h1 className="font-display mt-1 text-2xl font-black">Как это работает</h1>
          <div className="relative mt-8 grid gap-6 sm:grid-cols-3">
            {[
              { n: "1", t: "Пройди диагностику", d: "8–12 заданий, 7–10 минут — поймём твой уровень." },
              { n: "2", t: "Получи план подготовки", d: "Что повторить сегодня и на этой неделе." },
              { n: "3", t: "Тренируйся с ИИ-репетитором", d: "Объясняет ошибки, не выдавая готовых ответов." },
            ].map((s) => (
              <div key={s.n}>
                <span className="font-display flex h-11 w-11 items-center justify-center border-2 border-ink bg-hl text-base font-black">{s.n}</span>
                <h3 className="font-display mt-3 text-[14px] font-bold leading-snug">{s.t}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => finalizeAndGo("diagnostic")} className="btn btn-blue px-6 py-3 text-sm">
              Начать диагностику <Icon name="arrowR" size={16} />
            </button>
            <button onClick={() => finalizeAndGo("bank")} className="btn btn-ghost px-6 py-3 text-sm">
              Сразу к заданиям
            </button>
          </div>
        </Reveal>
      )}
    </div>
  );
}
