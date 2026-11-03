import { useEffect, useMemo, useState } from "react";
import type { EgeTask } from "../data/tasks";
import { SUBJECTS, type Subject } from "../data/tasks";
import { checkAnswer } from "../lib/utils";
import { pickDiagnosticTasks, scoreDiagnostic, LEVEL_LABEL, type DiagnosticAnswer, type DiagnosticResult } from "../lib/diagnostic";
import { stashGuestDiagnostic } from "../lib/guestDiagnostic";
import { reachGoalOnce } from "../lib/metrika";
import { persistDiagnostic } from "../lib/planStorage";
import { useAuth } from "../lib/auth";
import { getAvailableSubjects, getDiagnosticPick, hydrateDiagnosticTasks, isDiagnosticLoading, useTasksVersion } from "../lib/dbTasks";
import { Icon, Reveal, TaskStatement } from "./ui";
import DiagnosticParentCard from "./DiagnosticParentCard";
import { OfferStepHint } from "./WelcomeOfferBanner";

type Phase = "setup" | "running" | "result";

export default function DiagnosticView({
  subject: subjectProp,
  onFinish,
  onSkip,
  onSelectSubject,
  onSaveProgress,
}: {
  subject?: Subject;
  onFinish: (result: DiagnosticResult) => void;
  onSkip: () => void;
  /** гость без предмета в URL — выбор из доступных */
  onSelectSubject?: (subject: Subject) => void;
  /** гость после результата → регистрация */
  onSaveProgress?: (result: DiagnosticResult) => void;
}) {
  const { profile } = useAuth();
  const [subject, setSubject] = useState<Subject | undefined>(subjectProp);
  useTasksVersion();
  const [phase, setPhase] = useState<Phase>("setup");
  const [tasks, setTasks] = useState<EgeTask[]>([]);
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState("");
  const [answers, setAnswers] = useState<DiagnosticAnswer[]>([]);

  useEffect(() => {
    setSubject(subjectProp);
  }, [subjectProp]);

  useEffect(() => {
    if (subject) hydrateDiagnosticTasks(subject);
  }, [subject]);
  const loadingBank = subject ? isDiagnosticLoading(subject) : false;
  const meta = subject ? SUBJECTS[subject] : null;
  const task = tasks[idx];
  const result = useMemo(
    () => (phase === "result" && subject ? scoreDiagnostic(subject, answers) : null),
    [phase, subject, answers],
  );

  const pickSubject = (s: Subject) => {
    setSubject(s);
    setPhase("setup");
    setTasks([]);
    setIdx(0);
    setAnswers([]);
    setValue("");
    onSelectSubject?.(s);
  };

  const start = (n: number) => {
    if (!subject) return;
    setTasks(getDiagnosticPick(subject, n) ?? pickDiagnosticTasks(subject, n));
    setPhase("running");
  };

  const record = (given: string, skipped: boolean) => {
    if (!subject || !task) return;
    const correct = !skipped && checkAnswer(given, task.answers);
    const next = [...answers, { taskId: task.id, given, correct, skipped }];
    setAnswers(next);
    setValue("");
    if (idx + 1 >= tasks.length) {
      const scored = scoreDiagnostic(subject, next);
      if (profile) persistDiagnostic(profile.id, scored);
      else stashGuestDiagnostic(scored);
      reachGoalOnce("diagnostic_done", "diagnostic_done");
      setPhase("result");
    } else {
      setIdx((i) => i + 1);
    }
  };

  if (!subject) {
    const available = getAvailableSubjects();
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-16">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">бесплатно · 7–10 минут</p>
          <h1 className="font-display mt-1 text-2xl font-black">Выбери предмет для диагностики</h1>
          <p className="mt-2 max-w-xl text-[13.5px] text-ink2">
            Регистрация не нужна на этом шаге. После результата предложим сохранить план и скидку на первую оплату.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((id) => {
              const s = SUBJECTS[id];
              return (
                <button key={id} type="button" onClick={() => pickSubject(id)} className="sheet card-lift flex items-center gap-3 p-4 text-left">
                  <span className={`font-display flex h-11 w-11 shrink-0 items-center justify-center border-2 border-ink text-[12px] font-black ${s.color}`}>{s.short}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold">{s.name}</span>
                    <span className="block truncate text-[12px] text-ink2">{s.desc}</span>
                  </span>
                  <Icon name="arrowR" size={16} className="ml-auto shrink-0 text-ink2" />
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onSkip} className="btn btn-ghost mt-6 px-5 py-3 text-sm">
            Позже
          </button>
        </Reveal>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-16">
        {profile ? <OfferStepHint step="diagnostic" /> : (
          <div className="anim-rise mb-6 flex items-start gap-2.5 border-2 border-ink bg-hl px-3.5 py-2.5 text-[12.5px] leading-snug text-ink">
            <Icon name="spark" size={16} className="mt-0.5 shrink-0" />
            <p>
              <strong>Без регистрации.</strong> Пройди диагностику — потом сохранишь результат, короткий онбординг и скидку на первую оплату.
            </p>
          </div>
        )}
        <Reveal>
          <span className={`font-display inline-block border-2 border-ink px-2.5 py-1 text-[12px] font-black ${meta!.color}`}>{meta!.name}</span>
          <h1 className="font-display mt-4 text-2xl font-black">Диагностика по предмету</h1>
          <div className="sheet mt-5 space-y-2.5 p-5">
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="timer" size={16} className="text-ink" /> Примерное время: 7–10 минут</p>
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="list" size={16} className="text-ink" /> Количество заданий: 8–12</p>
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="target" size={16} className="text-ink" /> Цель: определить уровень и слабые темы</p>
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink2">
            Это не экзамен. Ошибаться нормально. Так мы поймём, что нужно повторить в первую очередь. Если не знаешь ответ — просто пропусти,
            это тоже поможет точнее определить слабые места. Подсказок здесь нет — иначе результат будет неточным.
          </p>
          {loadingBank ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink2">
              <Icon name="refresh" size={16} className="animate-spin" /> Загружаем банк по предмету…
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => start(10)} className="btn btn-blue px-6 py-3 text-sm">Начать диагностику <Icon name="arrowR" size={16} /></button>
              <button type="button" onClick={() => start(5)} className="btn btn-ghost px-5 py-3 text-sm">Короче — 5 заданий</button>
              {!profile && onSelectSubject && (
                <button type="button" onClick={() => { setSubject(undefined); setPhase("setup"); }} className="btn btn-ghost px-5 py-3 text-sm">Другой предмет</button>
              )}
              <button type="button" onClick={onSkip} className="btn btn-ghost px-5 py-3 text-sm">Пройти позже</button>
            </div>
          )}
        </Reveal>
      </div>
    );
  }

  if (phase === "running" && task) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-10">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] font-bold text-ink2">задание {idx + 1} из {tasks.length}</span>
          <span className="font-mono text-[11px] text-ink2">без подсказок</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-blue transition-all duration-500" style={{ width: `${(idx / tasks.length) * 100}%` }} />
        </div>

        <div key={task.id} className="sheet anim-rise mt-6 p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">{task.topic}</p>
          <div className="mt-3 text-[15px] leading-relaxed">
            <TaskStatement task={task} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && value.trim() && record(value, false)}
              placeholder="Твой ответ…"
              className="input-blank min-w-0 flex-1 rounded-sm px-4 py-3 text-base font-bold"
            />
            <button type="button" onClick={() => value.trim() && record(value, false)} className="btn btn-blue px-5 py-3 text-sm">Дальше <Icon name="arrowR" size={15} /></button>
          </div>
          <button type="button" onClick={() => record("", true)} className="link-slide mt-3 text-[12.5px] font-bold text-ink2 hover:text-ink">Не знаю — пропустить</button>
        </div>
      </div>
    );
  }

  if (phase === "result" && result) {
    const tone = result.level === "high" ? "text-green" : result.level === "mid" ? "text-amber" : "text-blue";
    const guest = !profile;
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-14">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">твой результат</p>
          <h1 className="font-display mt-1 text-2xl font-black">
            Уровень: <span className={tone}>{LEVEL_LABEL[result.level]}</span>
          </h1>
          <p className="mt-2 text-[13.5px] text-ink2">Верно {result.correctCount} из {result.totalCount} заданий.</p>

          <div className="sheet mt-5 p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Ориентировочный балл</p>
            <p className="font-display mt-1 text-3xl font-black">{result.estimatedScoreMin}–{result.estimatedScoreMax}</p>
            <p className="mt-1 text-[12px] text-ink2">Диапазон зависит от стабильности выполнения — это грубая оценка, не гарантия.</p>
          </div>

          {result.strongTopics.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-green">Сильные темы</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.strongTopics.map((t) => <span key={t} className="border border-green/40 bg-green/8 px-2.5 py-1 text-[12.5px] font-semibold text-green">{t}</span>)}
              </div>
            </div>
          )}
          {result.weakTopics.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber">Есть над чем поработать</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.weakTopics.map((t) => <span key={t} className="border border-amber/40 bg-amber/8 px-2.5 py-1 text-[12.5px] font-semibold text-amber">{t}</span>)}
              </div>
              <p className="mt-2 text-[12.5px] text-ink2">Вот темы, которые дадут наибольший рост баллов. Начнём с них в плане подготовки.</p>
            </div>
          )}

          <DiagnosticParentCard />

          {guest ? (
            <div className="mt-7 space-y-3">
              <div className="border-2 border-ink bg-hl px-4 py-3 text-[13px] leading-relaxed text-ink">
                <strong>Сохрани результат.</strong> Регистрация → короткий онбординг → план и скидка на первую оплату. Диагностика уже будет засчитана.
              </div>
              <button
                type="button"
                onClick={() => {
                  stashGuestDiagnostic(result);
                  (onSaveProgress ?? onFinish)(result);
                }}
                className="btn btn-blue px-6 py-3 text-sm"
              >
                Сохранить и зарегистрироваться <Icon name="arrowR" size={16} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => onFinish(result)} className="btn btn-blue mt-7 px-6 py-3 text-sm">Смотреть план подготовки <Icon name="arrowR" size={16} /></button>
          )}
        </Reveal>
      </div>
    );
  }

  return null;
}
