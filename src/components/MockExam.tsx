import { useEffect, useMemo, useState } from "react";
import { SUBJECTS, TASKS, type EgeTask, type Subject } from "../data/tasks";
import { checkAnswer, formatClock } from "../lib/utils";
import { useProgress } from "../lib/store";
import { callAiTutor, type EssayAssessment } from "../lib/aiTutor";
import { hydrateSubjectTasks, isSubjectLoading, useTasksVersion } from "../lib/dbTasks";
import { Icon, Reveal } from "./ui";

type Phase = "setup" | "running" | "grading" | "result";
const PART1_COUNT = 6;
const PART2_SECONDS = 15 * 60;
const PART1_SECONDS_PER_TASK = 90;

export default function MockExam({ subject, onFinish, onExit }: { subject: Subject; onFinish: () => void; onExit: () => void }) {
  const meta = SUBJECTS[subject];
  const { addAttempt } = useProgress();
  const tasksVersion = useTasksVersion();
  const [phase, setPhase] = useState<Phase>("setup");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [essayAssessment, setEssayAssessment] = useState<EssayAssessment | null>(null);

  useEffect(() => {
    hydrateSubjectTasks(subject);
  }, [subject]);
  const loadingBank = isSubjectLoading(subject);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const part1 = useMemo(() => TASKS.filter((t) => t.subject === subject && t.answerType !== "essay").slice(0, PART1_COUNT), [subject, tasksVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const part2 = useMemo(() => TASKS.find((t) => t.subject === subject && t.answerType === "essay"), [subject, tasksVersion]);
  const allTasks: EgeTask[] = part2 ? [...part1, part2] : part1;
  const totalSeconds = part1.length * PART1_SECONDS_PER_TASK + (part2 ? PART2_SECONDS : 0);
  const current = allTasks[idx];

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setTimeLeft((t) => (t <= 1 ? 0 : t - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "running" && timeLeft === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  const start = () => {
    setTimeLeft(totalSeconds);
    setPhase("running");
  };

  const finish = async () => {
    setPhase("grading");
    let assessment: EssayAssessment | null = null;
    if (part2) {
      const res = await callAiTutor({ mode: "check_essay", taskId: part2.id, essayText: answers[part2.id] ?? "" }, { mistakeTasks: [], solvedCount: 0 });
      assessment = res.assessment ?? null;
      setEssayAssessment(assessment);
      if (assessment) {
        addAttempt({ taskId: part2.id, given: `${assessment.total}/${assessment.max}`, correct: assessment.total / Math.max(1, assessment.max) >= 0.6, ts: Date.now(), seconds: 0 });
      }
    }
    for (const t of part1) {
      const given = answers[t.id] ?? "";
      const correct = checkAnswer(given, t.answers);
      addAttempt({ taskId: t.id, given: given || "(пропущено)", correct, ts: Date.now(), seconds: 0 });
    }
    setPhase("result");
  };

  if (phase === "setup") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Reveal>
          <span className={`font-display inline-block border-2 border-ink px-2.5 py-1 text-[12px] font-black ${meta.color}`}>{meta.name}</span>
          <h1 className="font-display mt-4 text-2xl font-black">Пробный вариант</h1>
          <div className="sheet mt-5 space-y-2.5 p-5">
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="list" size={16} /> Часть 1: {part1.length} заданий с кратким ответом</p>
            {part2 && <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="book" size={16} /> Часть 2: 1 задание с развёрнутым ответом</p>}
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="timer" size={16} /> Время: {formatClock(totalSeconds)}</p>
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink2">
            Режим «как на экзамене»: строгий порядок, таймер, без подсказок ИИ-репетитора. Разбор откроется после завершения.
          </p>
          {loadingBank && allTasks.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink2">
              <Icon name="refresh" size={16} className="animate-spin" /> Загружаем банк по предмету…
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={start} disabled={allTasks.length === 0} className="btn btn-blue px-6 py-3 text-sm">Начать пробник <Icon name="arrowR" size={16} /></button>
              <button onClick={onExit} className="btn btn-ghost px-5 py-3 text-sm">Позже</button>
            </div>
          )}
        </Reveal>
      </div>
    );
  }

  if ((phase === "running" || phase === "grading") && current) {
    const isEssay = current.answerType === "essay";
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] font-bold uppercase text-red">экзамен-режим</span>
          <span className={`ml-auto flex items-center gap-1.5 border-2 px-2.5 py-1 font-mono text-[13px] font-bold tabular-nums ${timeLeft < 60 ? "border-red text-red" : "border-ink/25 text-ink"}`}>
            <Icon name="timer" size={14} /> {formatClock(timeLeft)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {allTasks.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setIdx(i)}
              className={`h-8 w-8 border-2 font-mono text-[12px] font-bold ${i === idx ? "border-blue bg-blue text-white" : answers[t.id] ? "border-green/50 bg-green/10 text-green" : "border-ink/20 text-ink2"}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="sheet mt-4 p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">{current.topic} {isEssay ? "· развёрнутый ответ" : ""}</p>
          <div className="mt-3 space-y-2 text-[15px] leading-relaxed">
            {current.statement.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          {isEssay ? (
            <textarea
              value={answers[current.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
              rows={10}
              placeholder="Пиши ответ здесь…"
              className="input-blank mt-4 w-full resize-y rounded-sm px-4 py-3 text-[14.5px] leading-relaxed"
            />
          ) : (
            <input
              value={answers[current.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
              placeholder="Ответ…"
              className="input-blank mt-4 w-full rounded-sm px-4 py-3 text-base font-bold"
            />
          )}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button disabled={idx === 0} onClick={() => setIdx((i) => i - 1)} className="btn btn-ghost px-4 py-2.5 text-sm">Назад</button>
            {idx < allTasks.length - 1 ? (
              <button onClick={() => setIdx((i) => i + 1)} className="btn btn-ink px-5 py-2.5 text-sm">Дальше <Icon name="arrowR" size={15} /></button>
            ) : (
              <button onClick={finish} disabled={phase === "grading"} className="btn btn-blue px-5 py-2.5 text-sm">
                {phase === "grading" ? "Проверяем…" : "Завершить пробник"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "result") {
    const shortCorrect = part1.filter((t) => checkAnswer(answers[t.id] ?? "", t.answers));
    const shortPoints = shortCorrect.reduce((s, t) => s + t.points, 0);
    const essayPoints = essayAssessment?.total ?? 0;
    const primary = shortPoints + essayPoints;
    const maxPrimary = part1.reduce((s, t) => s + t.points, 0) + (part2 ? part2.points : 0);
    const fraction = maxPrimary ? primary / maxPrimary : 0;
    const secMin = Math.max(0, Math.round(20 + fraction * 72 - 7));
    const secMax = Math.min(100, Math.round(20 + fraction * 72 + 7));
    const mistakes = part1.filter((t) => !checkAnswer(answers[t.id] ?? "", t.answers));

    return (
      <div className="mx-auto max-w-xl px-4 py-14">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">результаты пробника</p>
          <h1 className="font-display mt-1 text-2xl font-black">{meta.name}</h1>
          <div className="sheet mt-5 p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Первичные баллы</p>
            <p className="font-display mt-1 text-3xl font-black">{primary} <span className="text-base font-bold text-ink2">из {maxPrimary}</span></p>
            <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Ориентировочный тестовый балл</p>
            <p className="font-display mt-1 text-2xl font-black text-blue">{secMin}–{secMax}</p>
          </div>
          {essayAssessment && (
            <div className="sheet mt-4 p-5">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Часть 2 (развёрнутый ответ)</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{essayAssessment.summary}</p>
            </div>
          )}
          {mistakes.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber">Задания для отработки</p>
              <ul className="mt-2 space-y-1.5">
                {mistakes.map((t) => <li key={t.id} className="text-[13px] text-ink/80">• {t.topic}</li>)}
              </ul>
            </div>
          )}
          <button onClick={onFinish} className="btn btn-blue mt-6 px-6 py-3 text-sm">Итог сессии <Icon name="arrowR" size={16} /></button>
        </Reveal>
      </div>
    );
  }

  return null;
}
