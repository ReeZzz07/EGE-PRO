import { useEffect, useMemo, useRef, useState } from "react";
import { DIFF_LABEL, SUBJECTS, TASKS, taskById } from "../data/tasks";
import { useProgress } from "../lib/store";
import { checkAnswer, formatClock, plural } from "../lib/utils";
import type { View } from "./Header";
import TutorChat from "./TutorChat";
import EssayView from "./EssayView";
import { Burst, Icon, Stamp, useToast } from "./ui";

type Phase = "solve" | "wrong" | "correct" | "revealed";

export default function SolveView({ taskId, onNav }: { taskId: string; onNav: (v: View) => void }) {
  const task = taskById(taskId);

  // задания с развёрнутым ответом ведут в отдельный флоу — SolveView для них хуков не вызывает
  if (task && task.answerType === "essay") {
    const idx = TASKS.findIndex((t) => t.id === task.id);
    const nextTaskId = TASKS[(idx + 1) % TASKS.length].id;
    return <EssayView task={task} onNav={onNav} nextTaskId={nextTaskId} />;
  }

  const { derived, addAttempt } = useProgress();
  const { push } = useToast();
  const [phase, setPhase] = useState<Phase>("solve");
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wrongCount, setWrongCount] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [examMode, setExamMode] = useState(false);
  const [examLeft, setExamLeft] = useState(300);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordedRef = useRef(false);

  const meta = task ? SUBJECTS[task.subject] : null;
  const idx = task ? TASKS.findIndex((t) => t.id === task.id) : -1;
  const nextTask = useMemo(() => TASKS[(idx + 1) % TASKS.length], [idx]);

  // таймер
  useEffect(() => {
    if (phase !== "solve") return;
    const id = setInterval(() => {
      setSeconds((s) => s + 1);
      if (examMode) {
        setExamLeft((l) => {
          if (l <= 1) {
            return 0;
          }
          return l - 1;
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, examMode]);

  // время вышло в экзамен-режиме
  useEffect(() => {
    if (examMode && examLeft === 0 && phase === "solve" && !recordedRef.current) {
      recordedRef.current = true;
      addAttempt({ taskId, given: "(время вышло)", correct: false, ts: Date.now(), seconds });
      setPhase("revealed");
      push("Время вышло — разбор открыт", "err");
    }
  }, [examLeft, examMode, phase, taskId, seconds, addAttempt, push]);

  if (!task || !meta) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="font-display text-xl font-bold">Задание не найдено</p>
        <button onClick={() => onNav({ name: "bank" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">В банк заданий</button>
      </div>
    );
  }

  const toggleExam = () => {
    if (examMode) return; // не даём выключить посреди режима
    setExamMode(true);
    setExamLeft(300);
    push("Экзамен-режим: 5 минут, без подсказок", "info");
  };

  const submit = () => {
    const given = task.options ? [...picked].sort().join("") : value;
    if (!given.trim() && !task.options) {
      inputRef.current?.focus();
      setShakeKey((k) => k + 1);
      return;
    }
    const ok = checkAnswer(given, task.answers);
    if (ok) {
      addAttempt({ taskId, given, correct: true, ts: Date.now(), seconds });
      setPhase("correct");
      setBurstKey((k) => k + 1);
      const firstTime = !derived.solvedIds.has(task.id);
      push(firstTime ? `Верно! +${task.points} ${plural(task.points, "первичный балл", "первичных балла", "первичных баллов")}` : "Верно! Задание закреплено", "ok");
    } else {
      addAttempt({ taskId, given, correct: false, ts: Date.now(), seconds });
      const next = wrongCount + 1;
      setWrongCount(next);
      if (next >= 2) {
        setPhase("revealed");
        push("Две попытки — открыт разбор. Загляни в тетрадь ошибок", "err");
      } else {
        setPhase("wrong");
        setShakeKey((k) => k + 1);
        push("Неверно. Есть ещё одна попытка", "err");
      }
    }
  };

  const resetTask = () => {
    setPhase("solve");
    setValue("");
    setPicked(new Set());
    setWrongCount(0);
    setSeconds(0);
    setHintsUsed(0);
    recordedRef.current = false;
    if (examMode) setExamLeft(300);
  };

  const goTo = (v: View) => {
    onNav(v);
  };

  const isOptionTask = !!task.options;
  const locked = phase === "correct" || phase === "revealed";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      {/* верхняя панель */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={() => goTo({ name: "bank" })} className="link-slide flex items-center gap-2 text-sm font-bold text-ink2 hover:text-ink">
          <Icon name="arrowL" size={16} /> Банк заданий
        </button>
        <span className="font-mono text-[12px] text-ink2">задание {idx + 1} из {TASKS.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`flex items-center gap-1.5 border-2 px-2.5 py-1 font-mono text-[13px] font-bold tabular-nums ${examMode && examLeft < 60 ? "border-red text-red" : "border-ink/25 text-ink"}`}>
            <Icon name="timer" size={14} />
            {examMode ? formatClock(examLeft) : formatClock(seconds)}
          </span>
          {!examMode && phase === "solve" && (
            <button onClick={toggleExam} className="btn btn-ghost px-3 py-1.5 text-[12px]" title="5 минут на задание, без подсказок">
              <Icon name="timer" size={14} /> Экзамен-режим
            </button>
          )}
          {examMode && <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-red">экзамен</span>}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* ─── лист задания ─── */}
        <div className="relative">
          <Burst trigger={burstKey} />
          {phase === "correct" && (
            <div className="pointer-events-none absolute right-4 top-4 z-20">
              <Stamp text="Зачтено" tone="green" />
            </div>
          )}
          {phase === "revealed" && (
            <div className="pointer-events-none absolute right-4 top-4 z-20">
              <Stamp text="Разбор" tone="red" />
            </div>
          )}

          <div key={shakeKey} className={`sheet sheet-margin p-6 pl-12 sm:pl-16 sm:p-8 sm:pl-16 ${phase === "wrong" ? "anim-shake" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-display border-2 px-2 py-0.5 text-[11px] font-black ${meta.color}`} style={{ borderColor: "currentColor" }}>
                {meta.name}
              </span>
              <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">№ {task.fipiId} в банке ФИПИ</span>
              <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">задание №{task.egeNumber} ЕГЭ</span>
              <span className="ml-auto rounded-sm bg-ink px-2 py-0.5 font-mono text-[11px] font-bold text-hl">{task.points} п.б.</span>
            </div>

            <h1 className="font-display mt-4 text-xl font-bold leading-snug sm:text-2xl">{task.topic}</h1>

            <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/90">
              {task.statement.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            {/* варианты ответа */}
            {isOptionTask && (
              <div className="mt-5 space-y-2">
                {task.options!.map((opt, i) => {
                  const key = String(i + 1);
                  const on = picked.has(key);
                  return (
                    <button
                      key={key}
                      disabled={locked}
                      onClick={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(key)) n.delete(key);
                          else n.add(key);
                          return n;
                        })
                      }
                      className={`flex w-full items-start gap-3 border-2 px-3.5 py-2.5 text-left text-[14px] transition ${
                        on ? "border-blue bg-blue/8" : "border-ink/15 hover:border-ink/40"
                      } ${locked ? "opacity-60" : ""}`}
                    >
                      <span className={`font-mono flex h-6 w-6 shrink-0 items-center justify-center border-2 text-[12px] font-bold ${on ? "border-blue bg-blue text-white" : "border-ink/30 text-ink2"}`}>
                        {key}
                      </span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* бланк ответа */}
            {phase === "solve" || phase === "wrong" ? (
              <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
                <label className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink2">
                  {isOptionTask ? "Выбранные варианты (автосбор ответа)" : "Бланк ответов · поле № 1"}
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {isOptionTask ? (
                    <div className="input-blank flex min-h-[52px] flex-1 items-center gap-2 rounded-sm px-4 font-mono text-lg font-bold tracking-[0.3em]">
                      {picked.size ? [...picked].sort().join(" ") : <span className="text-sm font-normal tracking-normal text-ink2">отметь верные суждения выше…</span>}
                    </div>
                  ) : (
                    <input
                      ref={inputRef}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submit()}
                      placeholder={`Ответ (${task.answerNote})`}
                      className="input-blank min-w-0 flex-1 rounded-sm px-4 py-3 text-lg font-bold"
                      autoFocus
                    />
                  )}
                  <button onClick={submit} disabled={examMode && examLeft === 0} className="btn btn-blue px-6 py-3 text-sm">
                    Проверить <Icon name="check" size={16} />
                  </button>
                </div>
                {phase === "wrong" && (
                  <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
                    <Icon name="x" size={15} /> Неверно. Осталась одна попытка — перепроверь вычисления и условие.
                  </p>
                )}
                {examMode && examLeft < 60 && phase === "solve" && (
                  <p className="mt-3 font-mono text-[12px] font-bold uppercase text-red">⚠ меньше минуты</p>
                )}
              </div>
            ) : (
              <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
                {/* разбор */}
                <div className={`anim-rise border-2 p-4 ${phase === "correct" ? "border-green/50 bg-green/5" : "border-red/40 bg-red/5"}`}>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink2">
                    {phase === "correct" ? `верно · решено за ${formatClock(seconds)}${hintsUsed ? ` · подсказок: ${hintsUsed}` : ""}` : "правильное решение"}
                  </p>
                  <ol className="mt-3 space-y-2">
                    {task.explanation.map((s, i) => (
                      <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-ink/90">
                        <span className={`font-mono mt-0.5 text-[12px] font-bold ${phase === "correct" ? "text-green" : "text-red"}`}>{String(i + 1).padStart(2, "0")}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 font-mono text-[13px] font-bold text-ink">
                    Ответ: <span className="rounded-sm bg-hl px-1.5">{task.answers[0].replace(".", ",")}</span>
                    <span className="ml-2 font-normal text-ink2">({task.answerNote})</span>
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  <button onClick={() => goTo({ name: "task", id: nextTask.id })} className="btn btn-ink px-5 py-2.5 text-sm">
                    Следующее задание <Icon name="arrowR" size={16} />
                  </button>
                  <button onClick={resetTask} className="btn btn-ghost px-5 py-2.5 text-sm">
                    <Icon name="refresh" size={15} /> Решить ещё раз
                  </button>
                  <button onClick={() => goTo({ name: "mistakes" })} className="btn btn-ghost px-5 py-2.5 text-sm">
                    <Icon name="alert" size={15} /> Тетрадь ошибок
                  </button>
                  <button onClick={() => goTo({ name: "session-summary" })} className="btn btn-ghost px-5 py-2.5 text-sm">
                    Завершить сессию
                  </button>
                </div>
              </div>
            )}

            {/* подсказки */}
            {phase === "solve" || phase === "wrong" ? (
              <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-ink2">
                    <Icon name="bulb" size={16} className="text-amber" /> Подсказки репетитора ({hintsUsed}/3)
                  </p>
                  <div className="flex gap-2">
                    {examMode ? (
                      <span className="font-mono text-[11px] font-bold uppercase text-red">заблокировано в экзамен-режиме</span>
                    ) : (
                      [1, 2, 3].map((h) => (
                        <button
                          key={h}
                          onClick={() => setHintsUsed((n) => Math.max(n, h))}
                          disabled={hintsUsed >= h}
                          className={`border-2 px-2.5 py-1 text-[12px] font-bold transition ${
                            hintsUsed >= h ? "border-amber bg-amber/15 text-amber" : "border-ink/25 text-ink2 hover:border-amber hover:text-amber"
                          }`}
                        >
                          {h}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                {hintsUsed > 0 && !examMode && (
                  <div className="mt-3 space-y-2">
                    {task.hints.slice(0, hintsUsed).map((hint, i) => (
                      <p key={i} className="anim-rise flex gap-2.5 border-l-4 border-amber bg-amber/8 px-3 py-2 text-[13.5px] leading-relaxed text-ink/85">
                        <span className="font-mono text-[12px] font-bold text-amber">{i + 1}/3</span> {hint}
                      </p>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[12px] text-ink2">
                  Не хватает наводки? Репетитор справа объяснит тему и разберёт задание по шагам — спроси «<strong>объясни {task.topic.toLowerCase()}</strong>».
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* ─── репетитор ─── */}
        <aside className="min-w-0">
          <p className="font-mono mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-ink2">
            <Icon name="chat" size={14} /> репетитор рядом
          </p>
          <TutorChat contextTask={task} compact onNavigate={(dest) => goTo({ name: dest } as View)} />
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink2">
            Сложность: <strong>{DIFF_LABEL[task.difficulty]}</strong> · тема входит в задание №{task.egeNumber} ЕГЭ. Первичных баллов за задание: {task.points}.
          </p>
        </aside>
      </div>
    </div>
  );
}
