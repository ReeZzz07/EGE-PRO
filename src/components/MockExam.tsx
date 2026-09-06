import { useEffect, useMemo, useState } from "react";
import { SUBJECTS, taskById, type EgeTask, type Subject } from "../data/tasks";
import { checkAnswer, formatClock, plural } from "../lib/utils";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { useEssayCheckAllowed } from "../lib/tariffs";
import { callAiTutor, type EssayAssessment } from "../lib/aiTutor";
import { hydrateSubjectTasks, hydrateTasksByIds, isSubjectLoading, useTasksVersion } from "../lib/dbTasks";
import { convertByFraction, isGradeSubject, loadLatestScoreScale, lookupSecondary, type ScorePoint } from "../lib/scoreScale";
import { getExamStructure, pickExamVariant } from "../lib/examVariant";
import { getExamAttempt, saveExamAttempt } from "../lib/examAttempts";
import { Icon, Reveal } from "./ui";

type Phase = "setup" | "running" | "grading" | "result";
const PART1_SECONDS_PER_TASK = 90;
const PART2_SECONDS_PER_ESSAY = 15 * 60;

interface ResultSummary {
  primary: number;
  maxPrimary: number;
  secMin: number;
  secMax: number;
  mistakes: EgeTask[];
}

export default function MockExam({
  subject: subjectProp,
  retryAttemptId,
  onFinish,
  onExit,
}: {
  subject?: Subject;
  retryAttemptId?: number;
  onFinish: () => void;
  onExit: () => void;
}) {
  const { addAttempt } = useProgress();
  const { profile } = useAuth();
  // на бесплатном тарифе проверки сочинений нет (см. docker/api/server.js) — в новый случайный
  // вариант часть с развёрнутым ответом в этом случае не включаем вовсе (а не одно задание, как
  // было раньше: теперь у некоторых предметов таких заданий в реальной структуре несколько).
  const essayAllowed = useEssayCheckAllowed(profile) === true;
  const tasksVersion = useTasksVersion();

  // ── повторная попытка ранее сохранённого варианта (см. lib/examAttempts.ts) ──
  const [retrySubject, setRetrySubject] = useState<Subject | null>(null);
  const [retryTaskIds, setRetryTaskIds] = useState<string[] | null>(null);
  const [retryMissing, setRetryMissing] = useState(false);
  const [loadingRetry, setLoadingRetry] = useState(!!retryAttemptId);

  useEffect(() => {
    if (!retryAttemptId) return;
    let cancelled = false;
    getExamAttempt(retryAttemptId).then(async (att) => {
      if (cancelled) return;
      if (!att) {
        setRetryMissing(true);
        setLoadingRetry(false);
        return;
      }
      await hydrateTasksByIds(att.taskIds);
      if (cancelled) return;
      setRetrySubject(att.subject);
      setRetryTaskIds(att.taskIds);
      setLoadingRetry(false);
    });
    return () => {
      cancelled = true;
    };
  }, [retryAttemptId]);

  const subject = retrySubject ?? subjectProp;
  const meta = subject ? SUBJECTS[subject] : null;

  const [phase, setPhase] = useState<Phase>("setup");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [essayAssessments, setEssayAssessments] = useState<Record<string, EssayAssessment>>({});
  const [essayGradingIdx, setEssayGradingIdx] = useState(0);
  const [scoreScale, setScoreScale] = useState<{ year: number; scale: ScorePoint[] } | null>(null);
  const [variant, setVariant] = useState<EgeTask[]>([]);
  const [result, setResult] = useState<ResultSummary | null>(null);

  useEffect(() => {
    if (subject) loadLatestScoreScale(subject).then(setScoreScale);
  }, [subject]);

  // структура нужна и для превью на экране настройки, и (после прохождения) чтобы понять, вошла ли
  // в вариант ВСЯ часть с развёрнутым ответом — поэтому грузим целиком банк предмета всегда, даже
  // при повторной попытке (там для старта хватило бы точечной догрузки по id, см. выше, но полный
  // банк успевает подгрузиться в фоне за время прохождения — до момента подсчёта результата).
  useEffect(() => {
    if (subject) hydrateSubjectTasks(subject);
  }, [subject]);
  const loadingBank = subject ? isSubjectLoading(subject) : false;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const structure = useMemo(() => (subject ? getExamStructure(subject) : []), [subject, tasksVersion]);
  const essayPositionsCount = structure.filter((p) => p.essay).length;

  const retryTasks = useMemo(
    () => (retryTaskIds ? retryTaskIds.map((id) => taskById(id)).filter((t): t is EgeTask => !!t) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [retryTaskIds, tasksVersion]
  );

  // счётчики для экрана настройки: при повторе — по реально сохранённому набору, иначе — по живой
  // структуре предмета (сам вариант ещё не сгенерирован, он появится только по кнопке «Начать»)
  const previewAutoCount = retryTasks
    ? retryTasks.filter((t) => t.answerType !== "essay").length
    : structure.filter((p) => !p.essay).length;
  const previewEssayCount = retryTasks
    ? retryTasks.filter((t) => t.answerType === "essay").length
    : essayAllowed
      ? essayPositionsCount
      : 0;
  const previewTotalSeconds = retryTasks
    ? retryTasks.reduce((s, t) => s + (t.answerType === "essay" ? PART2_SECONDS_PER_ESSAY : PART1_SECONDS_PER_TASK), 0)
    : previewAutoCount * PART1_SECONDS_PER_TASK + previewEssayCount * PART2_SECONDS_PER_ESSAY;

  const current = variant[idx];
  const essayTasksInVariant = useMemo(() => variant.filter((t) => t.answerType === "essay"), [variant]);
  const autoTasksInVariant = useMemo(() => variant.filter((t) => t.answerType !== "essay"), [variant]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setTimeLeft((t) => (t <= 1 ? 0 : t - 1)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "running" && timeLeft === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  const start = () => {
    if (!subject) return;
    const picked = retryTasks ?? pickExamVariant(subject, essayAllowed);
    setVariant(picked);
    setTimeLeft(picked.reduce((s, t) => s + (t.answerType === "essay" ? PART2_SECONDS_PER_ESSAY : PART1_SECONDS_PER_TASK), 0));
    setIdx(0);
    setAnswers({});
    setEssayAssessments({});
    setPhase("running");
  };

  const finish = async () => {
    setPhase("grading");
    const essayTasks = variant.filter((t) => t.answerType === "essay");
    const autoTasks = variant.filter((t) => t.answerType !== "essay");
    const assessments: Record<string, EssayAssessment> = {};

    for (let i = 0; i < essayTasks.length; i++) {
      setEssayGradingIdx(i + 1);
      const t = essayTasks[i];
      const res = await callAiTutor({ mode: "check_essay", taskId: t.id, essayText: answers[t.id] ?? "" }, { mistakeTasks: [], solvedCount: 0 });
      if (res.assessment) {
        assessments[t.id] = res.assessment;
        addAttempt({
          taskId: t.id,
          given: `${res.assessment.total}/${res.assessment.max}`,
          correct: res.assessment.total / Math.max(1, res.assessment.max) >= 0.6,
          ts: Date.now(),
          seconds: 0,
        });
      }
    }
    for (const t of autoTasks) {
      const given = answers[t.id] ?? "";
      const correct = checkAnswer(given, t.answers);
      addAttempt({ taskId: t.id, given: given || "(пропущено)", correct, ts: Date.now(), seconds: 0 });
    }
    setEssayAssessments(assessments);

    const shortCorrect = autoTasks.filter((t) => checkAnswer(answers[t.id] ?? "", t.answers));
    const shortPoints = shortCorrect.reduce((s, t) => s + t.points, 0);
    const essayPoints = Object.values(assessments).reduce((s, a) => s + a.total, 0);
    const primary = shortPoints + essayPoints;
    const maxPrimary = variant.reduce((s, t) => s + t.points, 0);
    const fraction = maxPrimary ? primary / maxPrimary : 0;
    // вариант "полный" (покрывает всю реальную структуру предмета, включая часть с развёрнутым
    // ответом) — тогда первичный балл сравним напрямую со шкалой без пересчёта. Проверяем по факту
    // состава варианта, а не по тарифному флагу: то же верно и для повторной попытки старого
    // неполного варианта (см. lib/scoreScale.ts — convertByFraction как раз для частичного случая).
    const fullVariant = essayPositionsCount === 0 || essayTasks.length >= essayPositionsCount;

    let secMin: number;
    let secMax: number;
    if (scoreScale && fullVariant) {
      const sec = lookupSecondary(scoreScale.scale, primary) ?? 0;
      secMin = secMax = sec;
    } else if (scoreScale) {
      const lo = convertByFraction(scoreScale.scale, fraction - 0.1) ?? 0;
      const hi = convertByFraction(scoreScale.scale, fraction + 0.1) ?? lo;
      secMin = Math.min(lo, hi);
      secMax = Math.max(lo, hi);
    } else {
      secMin = Math.max(0, Math.round(20 + fraction * 72 - 7));
      secMax = Math.min(100, Math.round(20 + fraction * 72 + 7));
    }

    const mistakes = autoTasks.filter((t) => !checkAnswer(answers[t.id] ?? "", t.answers));
    setResult({ primary, maxPrimary, secMin, secMax, mistakes });

    if (subject && profile) {
      await saveExamAttempt(profile.id, {
        subject,
        taskIds: variant.map((t) => t.id),
        answers,
        primaryScore: primary,
        maxPrimary,
        secondaryScore: scoreScale ? (secMin === secMax ? secMin : null) : null,
        secondaryMax: scoreScale ? (isGradeSubject(subject) ? 5 : 100) : null,
        scaleYear: scoreScale?.year ?? null,
      });
    }

    setPhase("result");
  };

  if (loadingRetry) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Icon name="refresh" size={22} className="mx-auto animate-spin text-ink2" />
        <p className="mt-3 font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загружаем сохранённый вариант…</p>
      </div>
    );
  }

  if (retryMissing || !subject || !meta) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-display text-xl font-bold">Вариант не найден</p>
        <p className="mt-2 text-[13.5px] text-ink2">Возможно, он был удалён.</p>
        <button onClick={onExit} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">На главную</button>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Reveal>
          <span className={`font-display inline-block border-2 border-ink px-2.5 py-1 text-[12px] font-black ${meta.color}`}>{meta.name}</span>
          <h1 className="font-display mt-4 text-2xl font-black">{retryTaskIds ? "Повторная попытка" : "Пробный вариант"}</h1>
          <div className="sheet mt-5 space-y-2.5 p-5">
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="list" size={16} /> Часть 1: {previewAutoCount} заданий, автоматическая проверка</p>
            {previewEssayCount > 0 && (
              <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="book" size={16} /> Часть 2: {previewEssayCount} {plural(previewEssayCount, "задание", "задания", "заданий")} с развёрнутым ответом</p>
            )}
            <p className="flex items-center gap-2 text-[13.5px] text-ink2"><Icon name="timer" size={16} /> Время: {formatClock(previewTotalSeconds)}</p>
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink2">
            {retryTaskIds
              ? "Тот же набор заданий, что и в сохранённой попытке — состав не меняется."
              : "Полная структура реального экзамена по демоверсии ФИПИ: строгий порядок, таймер, без подсказок ИИ-репетитора. Конкретные задания на каждую позицию подбираются случайно при каждом заходе."}
          </p>
          {!retryTaskIds && !essayAllowed && essayPositionsCount > 0 && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">
              Часть 2 (развёрнутый ответ) с проверкой по критериям — на платных тарифах. Вариант ограничен частью 1.
            </p>
          )}
          {loadingBank && previewAutoCount + previewEssayCount === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink2">
              <Icon name="refresh" size={16} className="animate-spin" /> Загружаем банк по предмету…
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={start} disabled={previewAutoCount + previewEssayCount === 0} className="btn btn-blue px-6 py-3 text-sm">Начать <Icon name="arrowR" size={16} /></button>
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
          {variant.map((t, i) => (
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
            {idx < variant.length - 1 ? (
              <button onClick={() => setIdx((i) => i + 1)} className="btn btn-ink px-5 py-2.5 text-sm">Дальше <Icon name="arrowR" size={15} /></button>
            ) : (
              <button onClick={finish} disabled={phase === "grading"} className="btn btn-blue px-5 py-2.5 text-sm">
                {phase === "grading" ? (essayTasksInVariant.length > 1 ? `Проверяем ${essayGradingIdx} из ${essayTasksInVariant.length}…` : "Проверяем…") : "Завершить"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "result" && result) {
    const gradeMode = isGradeSubject(subject);

    return (
      <div className="mx-auto max-w-xl px-4 py-14">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">результаты</p>
          <h1 className="font-display mt-1 text-2xl font-black">{meta.name}</h1>
          <div className="sheet mt-5 p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Первичные баллы</p>
            <p className="font-display mt-1 text-3xl font-black">{result.primary} <span className="text-base font-bold text-ink2">из {result.maxPrimary}</span></p>
            <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
              {gradeMode ? "Ориентировочная оценка" : "Ориентировочный тестовый балл"}
            </p>
            <p className="font-display mt-1 text-2xl font-black text-blue">{result.secMin === result.secMax ? result.secMin : `${result.secMin}–${result.secMax}`}</p>
            {scoreScale && <p className="mt-1 font-mono text-[10px] text-ink2">по шкале {scoreScale.year} года</p>}
          </div>
          {essayTasksInVariant.length > 0 && (
            <div className="sheet mt-4 p-5">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Часть 2 (развёрнутый ответ)</p>
              <div className="mt-3 space-y-3">
                {essayTasksInVariant.map((t) => {
                  const a = essayAssessments[t.id];
                  return (
                    <div key={t.id} className="border-t border-dashed border-ink/15 pt-3 first:border-0 first:pt-0">
                      <p className="text-[12.5px] font-bold text-ink">{t.topic}</p>
                      {a ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-ink/85">{a.total}/{a.max} — {a.summary}</p>
                      ) : (
                        <p className="mt-1 text-[13px] text-ink2">Не проверено.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {result.mistakes.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber">Задания для отработки</p>
              <ul className="mt-2 space-y-1.5">
                {result.mistakes.map((t) => <li key={t.id} className="text-[13px] text-ink/80">• {t.topic}</li>)}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[12.5px] text-ink2">Этот набор заданий сохранён в статистике — его можно пройти повторно.</p>
          <button onClick={onFinish} className="btn btn-blue mt-6 px-6 py-3 text-sm">Итог сессии <Icon name="arrowR" size={16} /></button>
        </Reveal>
      </div>
    );
  }

  return null;
}
