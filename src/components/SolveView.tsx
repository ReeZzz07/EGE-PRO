import { useEffect, useMemo, useRef, useState } from "react";
import { DIFF_LABEL, SUBJECTS, TASKS, taskById, type EgeTask } from "../data/tasks";
import { useProgress } from "../lib/store";
import { checkAnswer, formatClock, plural } from "../lib/utils";
import { hydrateSubjectTasks, hydrateTasksByIds, useTasksVersion } from "../lib/dbTasks";
import { callAiTutor } from "../lib/aiTutor";
import { DEFAULT_FILTERS, filterTasks, loadTaskBankFilters } from "../lib/taskFilters";
import type { View } from "./Header";
import TutorChat from "./TutorChat";
import EssayView from "./EssayView";
import { Burst, Icon, Stamp, useToast } from "./ui";

type Phase = "solve" | "wrong" | "correct" | "revealed";

/** Тонкий диспетчер: находит задание (может быть ещё не подгружено — см. lib/dbTasks.ts) и
 *  решает, куда рендерить — сюда, а не внутрь SolveViewRegular, чтобы условность (задание не
 *  найдено / грузится / развёрнутый ответ) не превращалась в условный вызов хуков ниже. */
export default function SolveView({ taskId, onNav }: { taskId: string; onNav: (v: View) => void }) {
  useTasksVersion();
  const task = taskById(taskId);
  const [checkedRemote, setCheckedRemote] = useState(false);

  useEffect(() => {
    if (task) return;
    let cancelled = false;
    hydrateTasksByIds([taskId]).finally(() => {
      if (!cancelled) setCheckedRemote(true);
    });
    return () => {
      cancelled = true;
    };
  }, [task, taskId]);

  if (!task) {
    if (!checkedRemote) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <Icon name="refresh" size={28} className="animate-spin mx-auto text-ink/40" />
          <p className="font-display mt-4 text-lg font-bold">Загружаем задание…</p>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <p className="font-display text-xl font-bold">Задание не найдено</p>
        <button onClick={() => onNav({ name: "bank" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">В банк заданий</button>
      </div>
    );
  }

  if (task.answerType === "essay") {
    const idx = TASKS.findIndex((t) => t.id === task.id);
    const nextTaskId = TASKS[(idx + 1) % TASKS.length].id;
    return <EssayView task={task} onNav={onNav} nextTaskId={nextTaskId} />;
  }

  return <SolveViewRegular task={task} taskId={taskId} onNav={onNav} />;
}

function SolveViewRegular({ task, taskId, onNav }: { task: EgeTask; taskId: string; onNav: (v: View) => void }) {
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
  // подсказки больше не готовый текст из импорта (там до трети случаев фактически выдавали ответ) —
  // генерируются ИИ-репетитором по клику, каждый уровень отдельно и с кэшем на сессию решения
  const [hintTexts, setHintTexts] = useState<(string | null)[]>([null, null, null]);
  const [hintLoadingLevel, setHintLoadingLevel] = useState<number | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordedRef = useRef(false);

  const meta = SUBJECTS[task.subject];

  // догружаем весь предмет в фоне — иначе после прямого захода на задание (например, после
  // перезагрузки страницы — см. App.tsx) в TASKS есть только это одно задание, и список для
  // «предыдущее/следующее» ниже был бы искусственно из одного элемента
  useEffect(() => {
    hydrateSubjectTasks(task.subject);
  }, [task.subject]);

  // список для переключения «предыдущее/следующее» — тот же фильтр, с которым ушли из банка
  // заданий, если он относится к текущему предмету; иначе просто в рамках предмета решаемого
  // задания (не по всей базе — так пролистывание остаётся осмысленным)
  const scopedList = useMemo(() => {
    const stored = loadTaskBankFilters();
    const filters = stored.subject === task.subject ? stored : { ...DEFAULT_FILTERS, subject: task.subject };
    return filterTasks(filters, derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.subject, derived]);
  const scopedIdx = scopedList.findIndex((t) => t.id === task.id);
  const prevInScope = scopedIdx > 0 ? scopedList[scopedIdx - 1] : null;
  const nextInScope = scopedIdx >= 0 && scopedIdx < scopedList.length - 1 ? scopedList[scopedIdx + 1] : null;

  const idx = TASKS.findIndex((t) => t.id === task.id);
  const globalNextTask = useMemo(() => TASKS[(idx + 1) % TASKS.length], [idx]);
  const nextTask = nextInScope ?? globalNextTask;

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
      // разбор с готовым ответом больше не раскрывается автоматически после N неверных попыток —
      // ученик либо пробует ещё раз, либо идёт к репетитору разбирать тему (см. подсказку ниже
      // бланка ответа); полный разбор показывается только после верного ответа
      addAttempt({ taskId, given, correct: false, ts: Date.now(), seconds });
      setWrongCount((n) => n + 1);
      setPhase("wrong");
      setShakeKey((k) => k + 1);
      push("Неверно — попробуй ещё раз. Не получается — спроси репетитора справа, он объяснит тему", "err");
    }
  };

  const resetTask = () => {
    setPhase("solve");
    setValue("");
    setPicked(new Set());
    setWrongCount(0);
    setSeconds(0);
    setHintsUsed(0);
    setHintTexts([null, null, null]);
    setHintLoadingLevel(null);
    recordedRef.current = false;
    if (examMode) setExamLeft(300);
  };

  const goTo = (v: View) => {
    onNav(v);
  };

  const requestHint = async (level: number) => {
    setHintsUsed((n) => Math.max(n, level));
    if (hintTexts[level - 1] != null || hintLoadingLevel === level) return;
    setHintLoadingLevel(level);
    try {
      const res = await callAiTutor(
        { mode: "hint", message: "подсказка", taskId: task.id, hintLevel: level - 1, history: [] },
        { mistakeTasks: [], solvedCount: derived.solvedIds.size }
      );
      setHintTexts((arr) => {
        const copy = [...arr];
        copy[level - 1] = res.text ?? "Не получилось получить подсказку — попробуй ещё раз.";
        return copy;
      });
    } finally {
      setHintLoadingLevel(null);
    }
  };

  const isOptionTask = !!task.options;
  const locked = phase === "correct" || phase === "revealed";

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      {/* верхняя панель */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={() => goTo({ name: "bank" })} className="link-slide flex items-center gap-2 text-sm font-bold text-ink2 hover:text-ink">
          <Icon name="arrowL" size={16} /> Банк заданий
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => prevInScope && goTo({ name: "task", id: prevInScope.id })}
            disabled={!prevInScope || examMode}
            title={prevInScope ? `Предыдущее: ${prevInScope.topic}` : "Это первое задание в подборке"}
            className="flex h-9 w-9 items-center justify-center rounded-sm border-2 border-ink bg-paper text-ink shadow-[2px_2px_0_0_rgba(21,23,46,0.9)] transition hover:bg-ink hover:text-paper active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none"
          >
            <Icon name="arrowL" size={16} />
          </button>
          <span className="font-mono text-[12px] font-bold text-ink2">
            {scopedIdx >= 0 ? `${scopedIdx + 1} из ${scopedList.length}` : `${idx + 1} из ${TASKS.length}`}
          </span>
          <button
            onClick={() => nextInScope && goTo({ name: "task", id: nextInScope.id })}
            disabled={!nextInScope || examMode}
            title={nextInScope ? `Следующее: ${nextInScope.topic}` : "Это последнее задание в подборке"}
            className="flex h-9 w-9 items-center justify-center rounded-sm border-2 border-ink bg-paper text-ink shadow-[2px_2px_0_0_rgba(21,23,46,0.9)] transition hover:bg-ink hover:text-paper active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none"
          >
            <Icon name="arrowR" size={16} />
          </button>
        </div>
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

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.55fr_1fr]">
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
              {task.section && (
                <span className="rounded-sm border border-ink/25 px-2 py-0.5 text-[11px] font-semibold text-ink2">{task.section}</span>
              )}
              <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">задание №{task.egeNumber} ЕГЭ</span>
              <span className="ml-auto rounded-sm bg-ink px-2 py-0.5 font-mono text-[11px] font-bold text-hl">{task.points} п.б.</span>
            </div>

            <h1 className="font-display mt-4 text-xl font-bold leading-snug sm:text-2xl">{task.topic}</h1>

            <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/90">
              {task.statement.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            {task.images && task.images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {task.images.map((src, i) => (
                  <img key={i} src={src} alt={`Иллюстрация к заданию ${i + 1}`} className="max-h-72 rounded-sm border-2 border-ink/15 object-contain" />
                ))}
              </div>
            )}

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
                    <Icon name="x" size={15} /> Неверно{wrongCount > 1 ? ` (попытка ${wrongCount})` : ""} — перепроверь вычисления и условие, или попроси подсказку у репетитора.
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
                          onClick={() => requestHint(h)}
                          disabled={hintsUsed >= h}
                          className={`border-2 px-2.5 py-1 text-[12px] font-bold transition ${
                            hintsUsed >= h ? "border-amber bg-amber/15 text-amber" : "border-ink/25 text-ink2 hover:border-amber hover:text-amber"
                          }`}
                        >
                          {hintLoadingLevel === h ? <Icon name="refresh" size={12} className="animate-spin" /> : h}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                {hintsUsed > 0 && !examMode && (
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: hintsUsed }).map((_, i) => (
                      <p key={i} className="anim-rise flex gap-2.5 border-l-4 border-amber bg-amber/8 px-3 py-2 text-[13.5px] leading-relaxed text-ink/85">
                        <span className="font-mono text-[12px] font-bold text-amber shrink-0">{i + 1}/3</span>
                        {hintTexts[i] ?? (
                          <span className="flex items-center gap-2 text-ink2">
                            <Icon name="refresh" size={13} className="animate-spin" /> Репетитор придумывает подсказку…
                          </span>
                        )}
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
