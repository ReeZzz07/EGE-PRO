// Ранняя польза до регистрации (DEV brief / аудит маркетологов):
// предмет → одно короткое задание → разбор → похожее → CTA «сохранить прогресс» (регистрация).
// Не заменяет диагностику/онбординг — гипотеза активации, A/B позже.
import { useEffect, useMemo, useState } from "react";
import { SUBJECTS, TASKS, type EgeTask, type Subject } from "../data/tasks";
import { getAvailableSubjects, hydrateDiagnosticTasks, getDiagnosticPick, useTasksVersion } from "../lib/dbTasks";
import { checkAnswer } from "../lib/utils";
import { reachGoal, reachGoalOnce } from "../lib/metrika";
import { Icon, StatementBody } from "./ui";
import type { View } from "./Header";

const EARLY_FLAG = "ege-pro.early-value.v1";

export function markEarlyValueIntent() {
  try {
    sessionStorage.setItem(EARLY_FLAG, "1");
  } catch {
    /* ignore */
  }
}

export function consumeEarlyValueIntent(): boolean {
  try {
    if (!sessionStorage.getItem(EARLY_FLAG)) return false;
    sessionStorage.removeItem(EARLY_FLAG);
    return true;
  } catch {
    return false;
  }
}

type Phase = "pick" | "solve" | "result" | "similar" | "done";

function pickShortPair(subject: Subject): EgeTask[] {
  const fromDiag = getDiagnosticPick(subject, 8) ?? [];
  const pool = (fromDiag.length ? fromDiag : TASKS.filter((t) => t.subject === subject)).filter(
    (t) => t.answerType !== "essay" && t.answers.length > 0
  );
  if (pool.length === 0) return [];
  const first = pool[0];
  const similar =
    pool.find((t) => t.id !== first.id && (t.topic === first.topic || t.egeNumber === first.egeNumber)) ??
    pool.find((t) => t.id !== first.id) ??
    first;
  return similar.id === first.id ? [first] : [first, similar];
}

export default function EarlyValueView({
  subject: initialSubject,
  onNav,
}: {
  subject?: Subject;
  onNav: (v: View) => void;
}) {
  useTasksVersion();
  const subjects = useMemo(() => getAvailableSubjects(), []);
  const [subject, setSubject] = useState<Subject | null>(initialSubject ?? null);
  const [loading, setLoading] = useState(!!initialSubject);
  const [pair, setPair] = useState<EgeTask[]>([]);
  const [phase, setPhase] = useState<Phase>(initialSubject ? "solve" : "pick");
  const [taskIndex, setTaskIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    hydrateDiagnosticTasks(subject).then(() => {
      if (cancelled) return;
      const picked = pickShortPair(subject);
      if (!picked.length) {
        setError("Пока не удалось загрузить задание по этому предмету. Попробуй другой или начни с диагностики.");
        setLoading(false);
        return;
      }
      setPair(picked);
      setTaskIndex(0);
      setPhase("solve");
      setAnswer("");
      setCorrect(null);
      setHintUsed(false);
      setLoading(false);
      reachGoalOnce("anon_task_start", "anon_task_start", "session", { subject });
    });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const task = pair[taskIndex];

  const submit = () => {
    if (!task) return;
    const ok = checkAnswer(answer, task.answers);
    setCorrect(ok);
    setPhase("result");
  };

  const useHint = () => {
    setHintUsed(true);
    reachGoalOnce("anon_hint_used", "anon_hint_used", "session", { subject: subject ?? undefined });
  };

  const next = () => {
    if (taskIndex === 0 && pair.length > 1) {
      setTaskIndex(1);
      setPhase("similar");
      setAnswer("");
      setCorrect(null);
      setHintUsed(false);
      return;
    }
    if (taskIndex >= 1) reachGoalOnce("anon_similar_done", "anon_similar_done", "session");
    setPhase("done");
  };

  const goRegister = () => {
    markEarlyValueIntent();
    onNav({ name: "auth", mode: "signup" });
  };

  if (phase === "pick" || (!subject && !loading)) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">без регистрации</p>
        <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Попробуй одно задание</h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink2">
          Выбери предмет, реши задание, посмотри разбор. Потом — похожее. Аккаунт понадобится только чтобы сохранить прогресс.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {subjects.map((id) => (
            <button
              key={id}
              onClick={() => setSubject(id)}
              className="sheet card-lift flex items-center gap-3 p-4 text-left"
            >
              <span className={`flex h-10 w-10 items-center justify-center border-2 border-ink font-display text-[11px] font-black ${SUBJECTS[id].color}`}>
                {SUBJECTS[id].short}
              </span>
              <span className="font-bold text-[14px]">{SUBJECTS[id].name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => onNav({ name: "landing" })} className="link-slide mt-6 text-[13px] font-bold text-ink2 hover:text-ink">
          ← На главную
        </button>
      </div>
    );
  }

  if (loading || !task) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-24 text-center">
        <Icon name="refresh" size={28} className="mx-auto animate-spin text-ink/40" />
        <p className="font-display mt-4 text-lg font-bold">Готовим задание…</p>
        {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-16 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
          <Icon name="check" size={20} />
        </span>
        <h1 className="font-display mt-4 text-2xl font-black">Прогресс пока только в этой вкладке</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink2">
          Создай аккаунт — сохраним попытки, откроем диагностику и персональный план. Письмо с подтверждением займёт минуту.
        </p>
        <button onClick={goRegister} className="btn btn-blue mt-6 w-full justify-center px-5 py-3 text-sm">
          Сохранить прогресс — зарегистрироваться <Icon name="arrowR" size={16} />
        </button>
        <button onClick={() => onNav({ name: "onboarding", subject: subject ?? undefined })} className="btn btn-ghost mt-3 w-full justify-center px-5 py-2.5 text-sm">
          Или сразу к диагностике (нужен аккаунт)
        </button>
        <button onClick={() => onNav({ name: "landing" })} className="link-slide mt-4 text-[12.5px] font-bold text-ink2 hover:text-ink">
          На главную
        </button>
      </div>
    );
  }

  const title =
    phase === "similar" || taskIndex === 1
      ? "Похожее задание"
      : "Задание без регистрации";

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-10">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">
        {SUBJECTS[task.subject].name} · {title}
      </p>
      <h1 className="font-display mt-1 text-xl font-black sm:text-2xl">
        {taskIndex === 0 ? "Реши и разберись" : "Закрепи похожим"}
      </h1>

      <div className="sheet mt-5 p-5 sm:p-6">
        <StatementBody statement={task.statement} />
        {(phase === "solve" || phase === "similar") && (
          <div className="mt-5">
            <label className="text-[13px] font-bold" htmlFor="early-answer">
              Твой ответ
            </label>
            <input
              id="early-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1.5 w-full border-2 border-ink bg-paper px-3 py-2.5 text-[15px]"
              autoComplete="off"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={submit} disabled={!answer.trim()} className="btn btn-blue px-5 py-2.5 text-sm disabled:opacity-50">
                Проверить
              </button>
              {!hintUsed && task.hints?.[0] && (
                <button onClick={useHint} className="btn btn-ghost px-4 py-2.5 text-sm">
                  Подсказка
                </button>
              )}
            </div>
            {hintUsed && task.hints?.[0] && (
              <p className="mt-3 border-l-4 border-blue bg-blue/8 px-3 py-2 text-[13px] leading-relaxed text-ink2">{task.hints[0]}</p>
            )}
          </div>
        )}

        {phase === "result" && (
          <div className="mt-5">
            <p className={`font-display text-[16px] font-bold ${correct ? "text-teal" : "text-red"}`}>
              {correct ? "Верно" : "Пока неверно — смотри разбор"}
            </p>
            {task.explanation?.length > 0 && (
              <div className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink2">
                {task.explanation.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
            {!correct && task.answers[0] && (
              <p className="mt-3 text-[13px] text-ink2">
                Эталонный ответ: <strong className="text-ink">{task.answers[0]}</strong>
              </p>
            )}
            <button onClick={next} className="btn btn-ink mt-5 px-5 py-2.5 text-sm">
              {taskIndex === 0 && pair.length > 1 ? "Похожее задание" : "Дальше"} <Icon name="arrowR" size={16} />
            </button>
          </div>
        )}
      </div>

      <button onClick={() => onNav({ name: "landing" })} className="link-slide mt-6 text-[12.5px] font-bold text-ink2 hover:text-ink">
        ← На главную
      </button>
    </div>
  );
}
