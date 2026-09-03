import { useEffect, useRef, useState } from "react";
import type { EgeTask } from "../data/tasks";
import { SUBJECTS } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { useEssayCheckAllowed } from "../lib/tariffs";
import { callAiTutor, type EssayAssessment } from "../lib/aiTutor";
import { Icon } from "./ui";
import type { View } from "./Header";

type Phase = "write" | "checking" | "result";

const CHECK_STATUSES = ["Анализируем структуру…", "Проверяем аргументы…", "Оцениваем грамотность…", "Формируем комментарии…"];

interface DraftEntry {
  text: string;
  assessment: EssayAssessment;
}

async function persistSubmission(userId: string, task: EgeTask, draftNumber: number, text: string, assessment: EssayAssessment) {
  if (!supabase) return;
  const { data: sub, error: subErr } = await supabase
    .from("essay_submissions")
    .insert({ user_id: userId, task_id: task.id, draft_number: draftNumber, text })
    .select("id")
    .single();
  if (subErr || !sub) {
    console.warn("Не удалось сохранить черновик в Supabase:", subErr?.message);
    return;
  }
  const { error: asErr } = await supabase.from("essay_assessments").insert({
    submission_id: sub.id,
    criteria: assessment.criteria,
    total_score: assessment.total,
    max_score: assessment.max,
    summary: assessment.summary,
  });
  if (asErr) console.warn("Не удалось сохранить оценку в Supabase:", asErr.message);
}

export default function EssayView({ task, onNav, nextTaskId }: { task: EgeTask; onNav: (v: View) => void; nextTaskId: string }) {
  const { derived, addAttempt } = useProgress();
  const { profile, isGuestMode } = useAuth();
  const essayAllowed = useEssayCheckAllowed(profile);
  const [phase, setPhase] = useState<Phase>("write");
  const [text, setText] = useState("");
  const [statusIdx, setStatusIdx] = useState(0);
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const startRef = useRef(Date.now());

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const meta = SUBJECTS[task.subject];

  useEffect(() => {
    if (phase !== "checking") return;
    setStatusIdx(0);
    const id = setInterval(() => setStatusIdx((i) => Math.min(CHECK_STATUSES.length - 1, i + 1)), 700);
    return () => clearInterval(id);
  }, [phase]);

  const submit = async () => {
    if (!essayAllowed) return; // защита в глубину — кнопка и так скрыта, см. рендер ниже
    setPhase("checking");
    const mistakeTasks = [...derived.mistakeIds].map((id) => task.id === id ? task : undefined).filter((t): t is EgeTask => !!t);
    const res = await callAiTutor(
      { mode: "check_essay", taskId: task.id, essayText: text },
      { mistakeTasks, solvedCount: derived.solvedIds.size }
    );
    const assessment: EssayAssessment = res.assessment ?? {
      criteria: [],
      total: 0,
      max: task.points,
      summary: res.text ?? "Не удалось получить оценку.",
      improvementTips: [],
    };
    const draftNumber = drafts.length + 1;
    setDrafts((d) => [...d, { text, assessment }]);
    if (!isGuestMode && profile) persistSubmission(profile.id, task, draftNumber, text, assessment);

    const seconds = Math.round((Date.now() - startRef.current) / 1000);
    addAttempt({ taskId: task.id, given: `${assessment.total}/${assessment.max}`, correct: assessment.max > 0 && assessment.total / assessment.max >= 0.6, ts: Date.now(), seconds });
    setPhase("result");
  };

  const current = drafts[drafts.length - 1];
  const previous = drafts.length >= 2 ? drafts[drafts.length - 2] : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={() => onNav({ name: "bank" })} className="link-slide flex items-center gap-2 text-sm font-bold text-ink2 hover:text-ink">
          <Icon name="arrowL" size={16} /> Банк заданий
        </button>
        <span className="ml-auto rounded-sm bg-ink px-2 py-0.5 font-mono text-[11px] font-bold text-hl">{task.points} п.б.</span>
      </div>

      <div className="sheet sheet-margin mt-5 p-6 pl-12 sm:p-8 sm:pl-16">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-display border-2 px-2 py-0.5 text-[11px] font-black ${meta.color}`} style={{ borderColor: "currentColor" }}>{meta.name}</span>
          <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">№ {task.fipiId} в банке ФИПИ</span>
          <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">развёрнутый ответ</span>
        </div>
        <h1 className="font-display mt-4 text-xl font-bold leading-snug sm:text-2xl">{task.topic}</h1>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/90">
          {task.statement.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        {task.criteria && (
          <div className="mt-5 border-t-2 border-dashed border-ink/25 pt-4">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Критерии оценивания</p>
            <ul className="mt-2 space-y-1.5">
              {task.criteria.map((c) => (
                <li key={c.code} className="flex items-baseline gap-2 text-[13px] text-ink/80">
                  <span className="font-mono font-bold text-blue">{c.code}</span> {c.name} <span className="text-ink2">(до {c.max})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {essayAllowed === false && (
          <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
            <div className="border-2 border-blue/40 bg-blue/5 p-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">Только на платных тарифах</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
                Проверка развёрнутых ответов и сочинений по критериям ИИ-репетитором доступна на платных тарифах. На бесплатном — банк заданий с кратким
                ответом, диагностика и план по-прежнему без ограничений.
              </p>
              <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue mt-4 px-5 py-2.5 text-sm">
                Смотреть тарифы <Icon name="arrowR" size={16} />
              </button>
            </div>
          </div>
        )}

        {essayAllowed && phase === "write" && (
          <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
            <label className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink2">
              Черновик {drafts.length > 0 ? `№ ${drafts.length + 1}` : ""}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Пиши здесь свой ответ…"
              className="input-blank mt-2 w-full resize-y rounded-sm px-4 py-3 text-[14.5px] leading-relaxed"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className={`font-mono text-[12px] ${words < (task.minWords ?? 0) ? "text-amber" : "text-green"}`}>
                {words} слов {task.minWords ? `(рекомендовано от ${task.minWords})` : ""}
              </span>
            </div>
            <p className="mt-3 border-l-4 border-blue bg-blue/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
              ИИ проверит ответ по критериям и подскажет, что улучшить. Это предварительная оценка — на настоящем ЕГЭ работу проверяют эксперты.
            </p>
            <button onClick={submit} disabled={!text.trim()} className="btn btn-blue mt-4 px-6 py-3 text-sm">
              Отправить на проверку <Icon name="arrowR" size={16} />
            </button>
          </div>
        )}

        {essayAllowed && phase === "checking" && (
          <div className="mt-6 flex flex-col items-center gap-3 border-t-2 border-dashed border-ink/25 py-10 text-center">
            <div className="flex gap-1.5">
              <span className="typing-dot h-2 w-2 rounded-full bg-blue" />
              <span className="typing-dot h-2 w-2 rounded-full bg-blue" />
              <span className="typing-dot h-2 w-2 rounded-full bg-blue" />
            </div>
            <p className="font-mono text-[13px] font-bold text-ink2">Проверяем твой ответ · {CHECK_STATUSES[statusIdx]}</p>
          </div>
        )}

        {essayAllowed && phase === "result" && current && (
          <div className="anim-rise mt-6 border-t-2 border-dashed border-ink/25 pt-5">
            <div className="border-2 border-blue/40 bg-blue/5 p-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink2">Предварительная оценка</p>
              <p className="font-display mt-1 text-2xl font-black">
                {current.assessment.total} <span className="text-base font-bold text-ink2">из {current.assessment.max}</span>
                {previous && (
                  <span className={`ml-3 font-mono text-[13px] font-bold ${current.assessment.total > previous.assessment.total ? "text-green" : current.assessment.total < previous.assessment.total ? "text-red" : "text-ink2"}`}>
                    {current.assessment.total > previous.assessment.total ? "▲" : current.assessment.total < previous.assessment.total ? "▼" : "="} было {previous.assessment.total}
                  </span>
                )}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{current.assessment.summary}</p>
            </div>

            {current.assessment.criteria.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b-2 border-ink/20 text-left font-mono text-[11px] uppercase tracking-wide text-ink2">
                      <th className="py-2 pr-3">Критерий</th>
                      <th className="py-2 pr-3">Комментарий</th>
                      <th className="py-2 text-right">Балл</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.assessment.criteria.map((c) => (
                      <tr key={c.code} className="border-b border-dashed border-ink/15 align-top">
                        <td className="py-2.5 pr-3 font-semibold">{c.code} · {c.name}</td>
                        <td className="py-2.5 pr-3 text-ink/80">{c.comment}</td>
                        <td className="py-2.5 text-right font-mono font-bold">{c.score}/{c.max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {current.assessment.improvementTips.length > 0 && (
              <div className="mt-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber">Как улучшить</p>
                <ul className="mt-2 space-y-1.5">
                  {current.assessment.improvementTips.map((t, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink/85">
                      <Icon name="bulb" size={14} className="mt-0.5 shrink-0 text-amber" /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-4 text-[11.5px] text-ink2">Оценка ИИ является предварительной. На ЕГЭ работу проверяют эксперты по утверждённым критериям.</p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button onClick={() => setPhase("write")} className="btn btn-ink px-5 py-2.5 text-sm">
                <Icon name="refresh" size={15} /> Исправить ответ
              </button>
              <button onClick={() => onNav({ name: "task", id: nextTaskId })} className="btn btn-ghost px-5 py-2.5 text-sm">
                Следующее задание <Icon name="arrowR" size={16} />
              </button>
              <button onClick={() => onNav({ name: "session-summary" })} className="btn btn-ghost px-5 py-2.5 text-sm">
                Завершить сессию
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
