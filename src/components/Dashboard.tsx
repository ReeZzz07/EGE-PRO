import { SUBJECTS, TASKS, tasksOf, type Subject } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { loadDiagnosticResult, loadStudyPlan } from "../lib/planStorage";
import { addProfileSubject } from "../lib/profileSubjects";
import { useEffect, useMemo, useState } from "react";
import { dayIndex, formatClock, plural, useCountdown, useScramble } from "../lib/utils";
import { getAvailableSubjects, getGlobalPointsTotal, getGlobalTaskTotal, getSubjectPointsTotal, hydrateSubjectTasks, hydrateTasksByIds, isSubjectLoading, useTasksVersion } from "../lib/dbTasks";
import type { View } from "./Header";
import { Icon, ProgressRing, Reveal, useToast } from "./ui";

/** «Мои предметы» — тарифы обещают "N предметов на выбор" (public.tariffs.subjectsCount), эта
 *  секция и есть то самое место, где предмет реально добавляется (см. lib/profileSubjects.ts).
 *  Лимит по тарифу проверяет БД (триггер enforce_subject_limit) — здесь просто показываем её ответ. */
export function MySubjectsSection({ onNav }: { onNav: (v: View) => void }) {
  const { profile, refreshSubjects } = useAuth();
  const { push } = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Subject | null>(null);
  const subjects = profile?.subjects ?? [];
  const pickable = getAvailableSubjects().filter((s) => !subjects.includes(s));

  const addSubject = async (s: Subject) => {
    if (!profile) return;
    setBusy(s);
    const res = await addProfileSubject(profile.id, s);
    setBusy(null);
    if (res.error) {
      push(res.error, "err");
      return;
    }
    await refreshSubjects();
    setAdding(false);
    push(`Добавлено: ${SUBJECTS[s].name}`, "ok");
  };

  return (
    <section className="mt-14">
      <Reveal>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">мои предметы</p>
        <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Над чем готовишься</h2>
      </Reveal>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subjects.map((s) => {
          const meta = SUBJECTS[s];
          const hasDiagnostic = !!loadDiagnosticResult(s);
          return (
            <div key={s} className="sheet flex h-full flex-col p-5">
              <span className={`font-display inline-block w-fit border-2 border-ink px-2 py-0.5 text-[11px] font-black ${meta.color}`}>{meta.short}</span>
              <h3 className="font-display mt-3 text-lg font-bold leading-tight">{meta.name}</h3>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink2">{meta.desc}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {hasDiagnostic ? (
                  <>
                    <button onClick={() => onNav({ name: "plan", subject: s })} className="btn btn-ink px-3.5 py-2 text-[12.5px]">План</button>
                    <button onClick={() => onNav({ name: "mock-exam", subject: s })} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
                      <Icon name="timer" size={14} /> Пробник
                    </button>
                  </>
                ) : (
                  <button onClick={() => onNav({ name: "diagnostic", subject: s })} className="btn btn-ink px-3.5 py-2 text-[12.5px]">
                    <Icon name="target" size={14} /> Пройти диагностику
                  </button>
                )}
                <button onClick={() => onNav({ name: "bank", subject: s })} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">Банк</button>
              </div>
            </div>
          );
        })}

        {/* добавить ещё предмет — до лимита тарифа, дальше честно предлагаем тариф побольше */}
        <div className="sheet flex h-full flex-col border-dashed border-ink/30 p-5">
          {adding ? (
            pickable.length > 0 ? (
              <>
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Выбери предмет</p>
                <div className="mt-3 grid flex-1 grid-cols-2 gap-2 content-start">
                  {pickable.map((s) => (
                    <button
                      key={s}
                      onClick={() => addSubject(s)}
                      disabled={busy !== null}
                      className={`rounded-sm border-2 px-2 py-2 text-left text-[12px] font-bold transition disabled:opacity-40 ${SUBJECTS[s].color} border-ink/15 hover:border-ink/40`}
                    >
                      {busy === s ? "Добавляем…" : SUBJECTS[s].short}
                    </button>
                  ))}
                </div>
                <button onClick={() => setAdding(false)} className="btn btn-ghost mt-3 justify-center px-3.5 py-2 text-[12.5px]">Отмена</button>
              </>
            ) : (
              <p className="flex-1 text-[13px] leading-relaxed text-ink2">Уже все предметы платформы добавлены 🎉</p>
            )
          ) : (
            <button onClick={() => setAdding(true)} className="flex h-full w-full flex-col items-center justify-center gap-2 py-6 text-ink2 transition hover:text-ink">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-ink/30 text-lg">+</span>
              <span className="text-[13px] font-bold">Добавить предмет</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const TICKER = [
  "∑ 1/n² = π²/6", "E = mc²", "sin²α + cos²α = 1", "logₐb = ln b / ln a", "(a+b)² = a² + 2ab + b²", "V = 4/3·πr³",
  "F = m·a", "10101101₂ = 173₁₀", "P(A) = m/n", "f′(x₀) — угловой коэффициент касательной", "I = U/R", "кухОнный · звонИт · жалюзИ",
  "НН: стеклянный, оловянный, деревянный", "1 Кбайт = 1024 байта", "h = v₀²/2g",
];

function examTarget(): { date: Date; year: number } {
  const y = new Date().getFullYear();
  const thisYear = new Date(y, 5, 1, 10, 0, 0); // 1 июня
  const next = thisYear.getTime() > Date.now() ? thisYear : new Date(y + 1, 5, 1, 10, 0, 0);
  return { date: next, year: next.getFullYear() };
}

export default function Dashboard({ onNav }: { onNav: (v: View) => void }) {
  const { derived } = useProgress();
  useTasksVersion();
  const { profile } = useAuth();
  const primarySubject = profile?.primarySubject;
  const plan = primarySubject ? loadStudyPlan(primarySubject) : null;
  const exam = useMemo(examTarget, []);
  const cd = useCountdown(exam.date);
  const title = useScramble(`ЕГЭ·${exam.year}`);

  // «задание дня» и «личный зачёт» показываются в рамках выбранного предмета пользователя —
  // догружаем его банк в фоне, если он ещё не открывался в этой сессии (см. lib/dbTasks.ts).
  useEffect(() => {
    if (primarySubject) hydrateSubjectTasks(primarySubject);
  }, [primarySubject]);

  const subjStats = primarySubject ? derived.perSubject[primarySubject] : null;
  const total = subjStats ? subjStats.total : TASKS.length;
  const solved = subjStats ? subjStats.solved : derived.solvedIds.size;
  const progress = total ? solved / total : 0;

  const subjectPool = primarySubject ? tasksOf(primarySubject) : TASKS;
  const todayTask = subjectPool.length ? subjectPool[dayIndex(subjectPool.length)] : undefined;
  const todayTaskLoading = !todayTask && !!primarySubject && isSubjectLoading(primarySubject);
  const mistakes = [...derived.mistakeIds].slice(0, 3);

  // превью «на реванш» ссылается на задания по id — после перезагрузки страницы их может не быть
  // в TASKS, если предмет не открывался в этой сессии; догружаем точечно (см. lib/dbTasks.ts)
  useEffect(() => {
    if (mistakes.length) hydrateTasksByIds(mistakes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.mistakeIds]);

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      {/* ─── БЛАНК № 1 ─── */}
      <section className="sheet sheet-holes gridpaper relative mt-6 overflow-hidden">
        <div className="absolute right-5 top-5 hidden text-ink/70 sm:block" aria-hidden>
          {/* штрихкод бланка */}
          <svg width="110" height="34" viewBox="0 0 110 34">
            {[3, 8, 11, 17, 22, 25, 31, 38, 41, 47, 52, 58, 61, 67, 70, 76, 83, 86, 92, 97, 103].map((x, i) => (
              <rect key={i} x={x} y="0" width={i % 3 === 0 ? 3 : 1.5} height="26" fill="currentColor" />
            ))}
            <text x="0" y="33" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="currentColor">
              БЛАНК № 1 · РЕГИСТРАЦИИ
            </text>
          </svg>
        </div>

        <div className="grid grid-cols-1 gap-8 p-6 sm:p-10 lg:grid-cols-[1.5fr_1fr] lg:items-center">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-red">
              ● допуск подтверждён · основной период
            </p>
            <h1 className="font-display mt-3 text-[13vw] font-black leading-[0.95] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink2">
              Открытый банк заданий <span className="hl font-semibold text-ink">ФИПИ</span>, мгновенная проверка по эталону,
              тетрадь ошибок и <span className="hl font-semibold text-ink">ИИ-репетитор</span>, который объясняет, а не подглядывает.
            </p>

            {/* таймер */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {[
                { v: cd.days, l: "дней" },
                { v: cd.hours, l: "часов" },
                { v: cd.minutes, l: "минут" },
                { v: cd.seconds, l: "секунд" },
              ].map((b, i) => (
                <div key={b.l} className="flex items-center gap-3">
                  <div className="border-2 border-ink bg-sheet px-3 py-2 text-center shadow-[3px_3px_0_0_rgba(21,23,46,0.9)]">
                    <div className="font-mono text-2xl font-extrabold tabular-nums leading-none sm:text-3xl">{String(b.v).padStart(2, "0")}</div>
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-ink2">{b.l}</div>
                  </div>
                  {i < 3 && <span className="font-display text-xl font-black text-ink/30">:</span>}
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => onNav({ name: "bank" })} className="btn btn-blue px-6 py-3 text-sm">
                <Icon name="list" size={17} /> Открыть банк заданий
              </button>
              <button onClick={() => onNav({ name: "tutor" })} className="btn btn-ghost px-6 py-3 text-sm">
                <Icon name="chat" size={17} /> Спросить репетитора
              </button>
            </div>
          </div>

          {/* личная карточка */}
          <div className="sheet relative self-start border-ink/20 p-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink2">личный зачёт</p>
              <Icon name="sigma" size={18} className="text-blue" />
            </div>
            <div className="mt-4 flex items-center gap-5">
              <ProgressRing
                value={progress}
                size={92}
                stroke={9}
                label={
                  <div className="text-center leading-none">
                    <div className="font-display text-lg font-black">{Math.round(progress * 100)}%</div>
                    <div className="mt-0.5 font-mono text-[9px] text-ink2">{solved}/{total}</div>
                  </div>
                }
              />
              <div className="grid flex-1 gap-2.5">
                <div className="flex items-baseline justify-between border-b border-dashed border-ink/25 pb-1">
                  <span className="text-[12px] font-semibold text-ink2">Первичные баллы</span>
                  <span className="font-mono text-lg font-extrabold text-blue">{derived.earnedPoints}<span className="text-[11px] text-ink2">/{getGlobalPointsTotal()}</span></span>
                </div>
                <div className="flex items-baseline justify-between border-b border-dashed border-ink/25 pb-1">
                  <span className="text-[12px] font-semibold text-ink2">Серия дней</span>
                  <span className={`flex items-center gap-1 font-mono text-lg font-extrabold ${derived.streak ? "text-amber" : "text-ink2"}`}>{derived.streak}<Icon name="flame" size={16} /></span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-semibold text-ink2">Точность</span>
                  <span className="font-mono text-lg font-extrabold text-green">{Math.round(derived.accuracy * 100)}%</span>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {getAvailableSubjects().map((s) => {
                const st = derived.perSubject[s];
                const pct = st.total ? st.solved / st.total : 0;
                return (
                  <button key={s} onClick={() => onNav({ name: "bank", subject: s })} className="group flex w-full items-center gap-2.5 text-left">
                    <span className={`font-mono text-[10px] font-bold ${SUBJECTS[s].color}`}>{SUBJECTS[s].short}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                      <span className={`block h-full rounded-full ${SUBJECTS[s].bg} transition-all duration-700`} style={{ width: `${pct * 100}%` }} />
                    </span>
                    <span className="font-mono text-[10px] text-ink2">{st.solved}/{st.total}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── бегущая строка формул ─── */}
      <div className="mt-5 overflow-hidden border-y-2 border-ink bg-ink py-2" aria-hidden>
        <div className="marquee-track gap-10 font-mono text-[13px] font-semibold text-paper/90">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0 gap-10">
              {TICKER.map((f, i) => (
                <span key={i} className="flex items-center gap-10">
                  {f} <span className="text-hl">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ─── план на сегодня (раздел 8.1 ТЗ) ─── */}
      {plan && profile?.primarySubject && (
        <Reveal>
          <section className="mt-8 border-2 border-blue/40 bg-blue/5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-blue">план на сегодня · {SUBJECTS[profile.primarySubject].name}</p>
                <ul className="mt-2 space-y-1">
                  {plan.today.map((item, i) => (
                    <li key={i} className="text-[13.5px] leading-relaxed text-ink/85">• {item.label}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {plan.today.find((i) => i.taskIds.length) && (
                  <button onClick={() => onNav({ name: "task", id: plan.today.find((i) => i.taskIds.length)!.taskIds[0] })} className="btn btn-blue px-4 py-2.5 text-[13px]">
                    Продолжить <Icon name="arrowR" size={15} />
                  </button>
                )}
                <button onClick={() => onNav({ name: "plan" })} className="btn btn-ghost px-4 py-2.5 text-[13px]">План целиком</button>
                <button onClick={() => onNav({ name: "mock-exam" })} className="btn btn-ghost px-4 py-2.5 text-[13px]"><Icon name="timer" size={14} /> Пробник</button>
              </div>
            </div>
          </section>
        </Reveal>
      )}

      <MySubjectsSection onNav={onNav} />

      {/* ─── тренажёр по предметам ─── */}
      <section className="mt-14">
        <Reveal>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">раздел 01</p>
              <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Тренажёр по предметам</h2>
            </div>
            <button onClick={() => onNav({ name: "bank" })} className="link-slide hidden items-center gap-2 text-sm font-bold text-ink sm:flex">
              все {getGlobalTaskTotal()} заданий <Icon name="arrowR" size={16} />
            </button>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {getAvailableSubjects().map((id, idx) => {
            const s = SUBJECTS[id];
            const st = derived.perSubject[s.id];
            const pct = st.total ? Math.round((st.solved / st.total) * 100) : 0;
            const cls = idx === 0 ? "sm:col-span-2" : "";
            return (
              <Reveal key={s.id} delay={idx * 70} className={cls}>
                <button
                  onClick={() => onNav({ name: "bank", subject: s.id })}
                  className="sheet card-lift group flex h-full w-full flex-col p-5 text-left"
                >
                  <div className="flex items-start justify-between">
                    <span className={`font-display inline-block border-2 border-ink px-2 py-0.5 text-[11px] font-black ${s.color}`}>{s.short}</span>
                    <span className="font-mono text-[11px] text-ink2">{st.points} из {getSubjectPointsTotal(s.id)} п.б.</span>
                  </div>
                  <h3 className="font-display mt-3 text-lg font-bold leading-tight">{s.name}</h3>
                  <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink2">{s.desc}</p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between font-mono text-[11px] text-ink2">
                      <span>{st.solved} из {st.total} {plural(st.total, "задания", "заданий", "заданий")} решено</span>
                      <span className={s.color}>{pct}%</span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-ink/15 bg-paper">
                      <div className={`h-full ${s.bg} transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className={`mt-4 flex items-center gap-2 text-[13px] font-extrabold ${s.color}`}>
                    Тренироваться <Icon name="arrowR" size={15} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              </Reveal>
            );
          })}

          {/* карточка-ссылка на репетитора в сетке */}
          <Reveal delay={350}>
            <button onClick={() => onNav({ name: "tutor" })} className="card-lift gridpaper-dark flex h-full w-full flex-col border-2 border-night bg-night p-5 text-left text-paper">
              <span className="font-display inline-block w-fit border-2 border-hl px-2 py-0.5 text-[11px] font-black text-hl">ИИ</span>
              <h3 className="font-display mt-3 text-lg font-bold leading-tight">Репетитор на связи</h3>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-paper/65">Три уровня подсказок, полные разборы, карта слабых мест и план подготовки на неделю.</p>
              <span className="mt-4 flex items-center gap-2 text-[13px] font-extrabold text-hl">
                Задать вопрос <Icon name="arrowR" size={15} />
              </span>
            </button>
          </Reveal>
        </div>
      </section>

      {/* ─── задание дня + ошибки ─── */}
      <section className="mt-16 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Reveal>
          <div className="sheet sheet-margin h-full p-6 pl-14 sm:pl-16">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-red">раздел 02 · задание дня</p>
              {todayTask && <span className={`font-mono text-[11px] font-bold ${SUBJECTS[todayTask.subject].color}`}>№ {todayTask.fipiId}</span>}
            </div>
            {todayTask ? (
              <>
                <h3 className="font-display mt-3 text-xl font-bold leading-snug">{todayTask.topic}</h3>
                <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-ink2">{todayTask.statement[0]}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-ink2">
                  <span className="rounded-sm border border-ink/20 px-2 py-0.5">{SUBJECTS[todayTask.subject].name}</span>
                  <span className="rounded-sm border border-ink/20 px-2 py-0.5">{todayTask.points} первичный {plural(todayTask.points, "балл", "балла", "баллов")}</span>
                  <span className="rounded-sm border border-ink/20 px-2 py-0.5">{derived.solvedIds.has(todayTask.id) ? "уже решено ✓" : "ещё не решено"}</span>
                </div>
                <div className="mt-5">
                  <button onClick={() => onNav({ name: "task", id: todayTask.id })} className="btn btn-ink px-5 py-2.5 text-sm">
                    Решать <Icon name="arrowR" size={16} />
                  </button>
                </div>
              </>
            ) : todayTaskLoading ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-ink2">
                <Icon name="refresh" size={16} className="animate-spin" /> Загружаем банк по твоему предмету…
              </p>
            ) : (
              <p className="mt-4 text-sm text-ink2">
                {primarySubject ? "Пока нет заданий по этому предмету — загляни в банк заданий." : "Пройди онбординг, чтобы выбрать предмет — тогда здесь появится задание дня."}
              </p>
            )}
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="sheet h-full p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-red">раздел 03 · на реванш</p>
              <button onClick={() => onNav({ name: "mistakes" })} className="link-slide text-[12px] font-bold text-ink2">
                вся тетрадь
              </button>
            </div>
            {mistakes.length === 0 ? (
              <div className="mt-6 flex flex-col items-center py-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-green/50 text-green">
                  <Icon name="check" size={26} />
                </span>
                <p className="font-display mt-3 text-sm font-bold">Ошибок нет</p>
                <p className="mt-1 max-w-[220px] text-[12px] leading-relaxed text-ink2">Идеально чисто. Загляни в банк — там {getGlobalPointsTotal() - derived.earnedPoints} первичных баллов ждут тебя.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {mistakes.map((id) => {
                  const t = TASKS.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <li key={id}>
                      <button
                        onClick={() => onNav({ name: "task", id })}
                        className="group flex w-full items-center gap-3 border border-dashed border-red/40 bg-red/5 px-3 py-2.5 text-left transition hover:border-red hover:bg-red/10"
                      >
                        <Icon name="refresh" size={16} className="shrink-0 text-red" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{t.topic}</span>
                          <span className={`font-mono text-[10px] ${SUBJECTS[t.subject].color}`}>{SUBJECTS[t.subject].name} · № {t.fipiId}</span>
                        </span>
                        <Icon name="arrowR" size={15} className="text-ink2 transition group-hover:translate-x-0.5 group-hover:text-red" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Reveal>
      </section>

      {/* ─── как это работает ─── */}
      <section className="mt-16 pb-16">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">раздел 04 · метод</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Три шага до ста баллов</h2>
        </Reveal>
        <div className="relative mt-8 grid gap-8 sm:grid-cols-3">
          <div className="absolute left-0 right-0 top-7 hidden border-t-2 border-dashed border-ink/25 sm:block" aria-hidden />
          {[
            { n: "01", t: "Решаешь", d: "Задания из открытого банка ФИПИ с настоящей проверкой по эталону: ответ в бланк — вердикт мгновенно." },
            { n: "02", t: "Разбираешь", d: "Ошибки попадают в тетрадь. ИИ-репетитор объясняет тему, даёт подсказки ступенями и полный разбор." },
            { n: "03", t: "Закрепляешь", d: "Возвращаешься к ошибкам и решаешь их заново, пока не станет 100%. Статистика покажет слабые темы." },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="relative">
                <span className="font-display relative z-10 inline-flex h-14 w-14 items-center justify-center border-2 border-ink bg-hl text-lg font-black shadow-[3px_3px_0_0_#15172e]">
                  {s.n}
                </span>
                <h3 className="font-display mt-4 text-lg font-bold">{s.t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-12 border-l-4 border-blue bg-blue/5 px-4 py-3 text-[13px] leading-relaxed text-ink2">
            <strong className="text-ink">Источники:</strong> задания соответствуют формату Открытого банка заданий ФИПИ (fipi.ru).
            Платформа учебная и не является официальным ресурсом ФИПИ или Рособрнадзора. Перевод первичных баллов в тестовые зависит от шкалы конкретного года.
          </p>
        </Reveal>
      </section>
    </div>
  );
}
