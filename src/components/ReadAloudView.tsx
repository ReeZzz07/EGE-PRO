// Задание №39 ЕГЭ по английскому — «Чтение текста вслух»: единственный тип задания в банке, где
// ответ — устная речь, а не текст/выбор. Платформа не отправляет голос ученика никуда (ни на диск
// сервера, ни внешнему ИИ-провайдеру — Claude/Qwen не принимают аудио через тот же API, которым
// работает ИИ-репетитор) и не хранит запись после сессии. Самопроверка — через встроенное в браузер
// распознавание речи (Web Speech API, бесплатно, работает в Chrome/Edge, не во всех браузерах) и
// сравнение расшифровки с эталонным текстом (см. lib/readAloud.ts) — грубая оценка, не официальная,
// как и с сочинениями (см. EssayView.tsx: "эксперты на настоящем ЕГЭ оценивают иначе").
import { useEffect, useMemo, useState } from "react";
import type { EgeTask } from "../data/tasks";
import { SUBJECTS } from "../data/tasks";
import { useProgress } from "../lib/store";
import { formatClock } from "../lib/utils";
import { compareReadAloud, readAloudAccuracy, type ReadAloudWordResult } from "../lib/readAloud";
import { useVoiceRecorder } from "../lib/useVoiceRecorder";
import { Icon, MediaItem, StatementLine, usedImageMarkerIndices } from "./ui";
import type { View } from "./Header";

/** 1.5 минуты — как на настоящем ЕГЭ перед началом чтения вслух (задание №39). Не блокирует
 *  начало записи — это ориентир для подготовки, а не жёсткий лимит экзамен-режима. */
const PREPARE_SECONDS = 90;
/** Страховка от "забыл остановить" — сам текст в банке читается за 1-2 минуты. */
const MAX_RECORD_SECONDS = 180;

export default function ReadAloudView({ task, onNav, nextTaskId }: { task: EgeTask; onNav: (v: View) => void; nextTaskId: string }) {
  const { addAttempt } = useProgress();
  const recorder = useVoiceRecorder("en-US", MAX_RECORD_SECONDS);

  const meta = SUBJECTS[task.subject];
  // Первый абзац у ЭТОГО типа задания — всегда фиксированная инструкция ЕГЭ ("Imagine that you
  // are preparing a project... You have 1.5 minutes to read the text silently..."), одна и та же
  // во всех 69 заданиях банка (проверено) — сама она вслух не читается, читается только текст
  // после неё. Без этого сравнение либо засчитывало инструкцию в счёт прочитанного (если ученик её
  // не озвучивал — а он и не должен), либо подсвечивало как "непрочитанную", хотя её и не нужно
  // было читать.
  const referenceText = useMemo(() => task.statement.slice(1).join(" "), [task]);
  const extraImages = useMemo(() => {
    const used = usedImageMarkerIndices(task.statement);
    return (task.images ?? []).filter((_, i) => !used.has(i));
  }, [task]);

  const comparison: ReadAloudWordResult[] | null = useMemo(() => {
    if (recorder.transcript == null) return null;
    return compareReadAloud(referenceText, recorder.transcript);
  }, [referenceText, recorder.transcript]);
  const accuracy = comparison ? readAloudAccuracy(comparison) : null;

  // засчитываем попытку сразу по завершении записи — один раз на каждую остановку записи
  useEffect(() => {
    if (recorder.phase !== "done") return;
    const acc = comparison ? readAloudAccuracy(comparison) : null;
    addAttempt({
      taskId: task.id,
      given: acc != null ? `аудио, ~${Math.round(acc * 100)}% слов` : "аудио без автосверки",
      correct: acc != null ? acc >= 0.6 : true,
      ts: Date.now(),
      seconds: recorder.seconds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.phase]);

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
          <span className="rounded-sm border border-ink/25 px-2 py-0.5 font-mono text-[11px] text-ink2">чтение вслух</span>
        </div>
        <h1 className="font-display mt-4 text-xl font-bold leading-snug sm:text-2xl">{task.topic}</h1>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/90">
          {task.statement.map((p, i) =>
            // Первый абзац у этого типа задания — всегда служебная инструкция ЕГЭ (см. комментарий
            // у referenceText выше: она не читается вслух и не участвует в самопроверке) — визуально
            // отделяем её от самого текста для чтения, чтобы это было понятно и на глаз, не только
            // по смыслу условия.
            i === 0 ? (
              <div key={i} className="flex items-start gap-2 rounded-sm border-l-4 border-amber/50 bg-amber/8 px-3 py-2.5">
                <Icon name="alert" size={14} className="mt-[3px] shrink-0 text-amber" />
                <div>
                  <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber">Инструкция · не читается вслух</p>
                  <p className="mt-1 text-[13.5px] italic leading-relaxed text-ink2">
                    <StatementLine text={p} images={task.images} />
                  </p>
                </div>
              </div>
            ) : (
              <p key={i}>
                <StatementLine text={p} images={task.images} />
              </p>
            )
          )}
        </div>

        {extraImages.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {extraImages.map((src, i) => <MediaItem key={i} src={src} />)}
          </div>
        )}

        {recorder.phase === "idle" && (
          <PrepareStep micError={recorder.micError} onStart={recorder.start} />
        )}

        {recorder.phase === "recording" && (
          <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red/60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red" />
              </span>
              <p className="font-mono text-[13px] font-bold text-ink">Идёт запись — {formatClock(recorder.seconds)}</p>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink2">Читай текст выше вслух. Когда закончишь — нажми «Завершить запись».</p>
            <button onClick={recorder.stop} className="btn btn-ink mt-4 px-6 py-3 text-sm">
              Завершить запись
            </button>
          </div>
        )}

        {recorder.phase === "done" && (
          <div className="anim-rise mt-6 border-t-2 border-dashed border-ink/25 pt-5">
            <div className="border-2 border-blue/40 bg-blue/5 p-4">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink2">Твоя запись</p>
              {recorder.audioUrl && <audio src={recorder.audioUrl} controls className="mt-2 w-full" />}
            </div>

            {comparison ? (
              <div className="mt-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
                  Похоже, прочитано {accuracy != null ? Math.round(accuracy * 100) : 0}% слов текста
                </p>
                <p className="mt-2 text-[15px] leading-relaxed">
                  {comparison.map((r, i) => (
                    <span key={i} className={r.matched ? "text-ink/90" : "rounded-sm bg-red/15 text-red"}>
                      {r.word}{" "}
                    </span>
                  ))}
                </p>
                <p className="mt-3 text-[11.5px] text-ink2">
                  Подсвечено красным — слова, которые распознавание речи не услышало в записи (пропущены, произнесены неразборчиво или распознаны с ошибкой).
                  Это самопроверка браузером, не официальная оценка произношения — эксперты на настоящем ЕГЭ слушают запись сами.
                </p>
              </div>
            ) : (
              <p className="mt-4 border-l-4 border-amber bg-amber/8 px-3 py-2 text-[13px] leading-relaxed text-ink2">
                Автоматическая сверка с текстом работает через распознавание речи в браузере (Chrome/Edge) — в этом браузере оно недоступно. Прослушай свою
                запись сам и сравни с текстом выше.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button onClick={recorder.reset} className="btn btn-ink px-5 py-2.5 text-sm">
                <Icon name="refresh" size={15} /> Записать заново
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

/** Отдельным компонентом — только чтобы свой useState/useEffect для отсчёта подготовки не жил
 *  в общем теле ReadAloudView и не пересоздавался при каждом его ре-рендере (пересчёт таймера
 *  идёт независимо от recorder.phase, только пока сама эта подстраница смонтирована). */
function PrepareStep({ micError, onStart }: { micError: string | null; onStart: () => void }) {
  const [left, setLeft] = useState(PREPARE_SECONDS);
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-6 border-t-2 border-dashed border-ink/25 pt-5">
      <div className="flex items-center gap-3">
        <Icon name="timer" size={18} className="text-ink2" />
        <p className="font-mono text-[13px] font-bold text-ink2">
          {left > 0 ? <>На подготовку (прочитать про себя): {formatClock(left)}</> : "Время на подготовку истекло — можно начинать читать вслух"}
        </p>
      </div>
      <p className="mt-3 border-l-4 border-blue bg-blue/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
        На настоящем ЕГЭ даётся 1,5 минуты прочитать текст про себя, а затем — прочитать его вслух без ошибок, с правильной интонацией. Здесь можно начать
        запись в любой момент, времени на подготовку хватать не обязательно.
      </p>
      {micError && <p className="mt-3 text-[13px] font-bold text-red">{micError}</p>}
      <button onClick={onStart} className="btn btn-blue mt-4 px-6 py-3 text-sm">
        <Icon name="mic" size={16} /> Начать запись
      </button>
    </div>
  );
}
