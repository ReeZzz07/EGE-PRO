import { useEffect, useState } from "react";
import { SUBJECTS, taskById } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { formatClock, formatDay, plural } from "../lib/utils";
import { getAvailableSubjects, getGlobalPointsTotal, getGlobalTaskTotal, hydrateTasksByIds, useTasksVersion } from "../lib/dbTasks";
import type { View } from "./Header";
import TutorChat from "./TutorChat";
import { Icon, Reveal } from "./ui";

/* ─────────── Тетрадь ошибок ─────────── */
export function MistakesView({ onNav }: { onNav: (v: View) => void }) {
  const { state, derived, clearTask } = useProgress();
  useTasksVersion();
  // после перезагрузки страницы TASKS снова пуст — задания из ошибок надо точечно догрузить по id
  // (их предметы могли не открываться в этой сессии), см. lib/dbTasks.ts
  useEffect(() => {
    hydrateTasksByIds([...derived.mistakeIds]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.mistakeIds]);
  const mistakes = [...derived.mistakeIds].map((id) => taskById(id)!).filter(Boolean);

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-red">работа над ошибками</p>
          <h1 className="font-display mt-1 text-3xl font-black sm:text-4xl">Тетрадь ошибок</h1>
        </div>
        <p className="text-sm font-semibold text-ink2">
          {mistakes.length
            ? `${mistakes.length} ${plural(mistakes.length, "задание ждёт", "задания ждут", "заданий ждут")} реванша`
            : "тетрадь пуста"}
        </p>
      </div>

      {mistakes.length === 0 ? (
        <Reveal>
          <div className="sheet mt-6 flex flex-col items-center px-6 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-green/60 text-green">
              <Icon name="check" size={30} />
            </span>
            <p className="font-display mt-4 text-xl font-bold">Ни одной ошибки!</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink2">
              {derived.attempts.length === 0
                ? "Ты ещё не начал решать — самое время. Каждая решённая задача приближает к сотне баллов."
                : "Все ошибки уже разобраны и исправлены. Так держать — возвращайся в банк за новыми баллами."}
            </p>
            <button onClick={() => onNav({ name: "bank" })} className="btn btn-blue mt-6 px-6 py-3 text-sm">
              В банк заданий <Icon name="arrowR" size={16} />
            </button>
          </div>
        </Reveal>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {mistakes.map((t, i) => {
            const meta = SUBJECTS[t.subject];
            const wrongs = state.attempts.filter((a) => a.taskId === t.id && !a.correct);
            const last = wrongs[wrongs.length - 1];
            return (
              <Reveal key={t.id} delay={(i % 4) * 70}>
                <div className="sheet card-lift flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`font-display border-2 px-1.5 py-0.5 text-[10px] font-black ${meta.color}`} style={{ borderColor: "currentColor" }}>
                      {meta.short} · №{t.egeNumber}
                    </span>
                    <span className="font-mono text-[11px] text-ink2">№ {t.fipiId}</span>
                  </div>
                  <h3 className="font-display mt-3 text-base font-bold leading-snug">{t.topic}</h3>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-relaxed text-ink2">{t.statement[0]}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-ink/20 pt-3 text-[12px]">
                    <span className="flex items-center gap-1.5 font-bold text-red">
                      <Icon name="x" size={13} /> {wrongs.length} {plural(wrongs.length, "ошибка", "ошибки", "ошибок")}
                    </span>
                    {last && (
                      <span className="font-mono text-ink2">
                        последний ответ: <span className="rounded-sm bg-red/10 px-1.5 font-bold text-red">{last.given || "—"}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => onNav({ name: "task", id: t.id })} className="btn btn-ink px-4 py-2 text-[13px]">
                      <Icon name="refresh" size={14} /> Решить заново
                    </button>
                    <button
                      onClick={() => clearTask(t.id)}
                      className="btn btn-ghost px-4 py-2 text-[13px]"
                      title="Убрать задание и его историю из тетради"
                    >
                      <Icon name="trash" size={14} /> Убрать
                    </button>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      )}

      {mistakes.length > 0 && (
        <Reveal delay={150}>
          <p className="mt-8 border-l-4 border-red bg-red/5 px-4 py-3 text-[13px] leading-relaxed text-ink2">
            <strong className="text-ink">Совет репетитора:</strong> сначала попроси объяснить тему каждого задания, затем реши заново{" "}
            <em>без подсказок</em>. Ошибка уходит из тетради автоматически, как только задание решено верно.
          </p>
        </Reveal>
      )}
    </div>
  );
}

/* ─────────── Статистика ─────────── */
export function StatsView({ onNav }: { onNav: (v: View) => void }) {
  const { derived, resetAll } = useProgress();
  useTasksVersion();
  const { isGuestMode } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const atts = derived.attempts;
  const hours = Math.floor(derived.totalTimeSec / 3600);
  const mins = Math.floor((derived.totalTimeSec % 3600) / 60);

  // «последние попытки» ссылаются на задания по id — после перезагрузки страницы их может не быть
  // в TASKS, если предмет не открывался в этой сессии; догружаем точечно (см. lib/dbTasks.ts)
  useEffect(() => {
    hydrateTasksByIds(derived.recent.map((a) => a.taskId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.recent]);

  const summary = [
    { label: "Попыток всего", value: String(atts.length), icon: "list" },
    { label: "Точность", value: `${Math.round(derived.accuracy * 100)}%`, icon: "target" },
    { label: "Первичные баллы", value: `${derived.earnedPoints}/${getGlobalPointsTotal()}`, icon: "star" },
    { label: "Время за решением", value: hours ? `${hours} ч ${mins} м` : `${mins} мин`, icon: "timer" },
    { label: "Серия дней", value: String(derived.streak), icon: "flame" },
    { label: "Заданий решено", value: `${derived.solvedIds.size}/${getGlobalTaskTotal()}`, icon: "check" },
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      <div className="mt-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">личный протокол</p>
        <h1 className="font-display mt-1 text-3xl font-black sm:text-4xl">Статистика</h1>
      </div>

      {/* сводка */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summary.map((s, i) => (
          <Reveal key={s.label} delay={i * 50}>
            <div className="sheet card-lift h-full p-4">
              <Icon name={s.icon} size={18} className="text-blue" />
              <div className="font-display mt-2 text-xl font-black leading-none">{s.value}</div>
              <div className="mt-1.5 text-[11px] font-semibold leading-tight text-ink2">{s.label}</div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* по предметам */}
        <Reveal>
          <div className="sheet p-6">
            <h2 className="font-display text-lg font-bold">Прогресс по предметам</h2>
            <div className="mt-5 space-y-5">
              {getAvailableSubjects().map((s) => {
                const meta = SUBJECTS[s];
                const st = derived.perSubject[s];
                const pct = st.total ? Math.round((st.solved / st.total) * 100) : 0;
                const acc = st.attempts ? Math.round((st.correct / st.attempts) * 100) : null;
                return (
                  <div key={s}>
                    <div className="flex items-baseline justify-between">
                      <span className="flex items-center gap-2 text-[14px] font-bold">
                        <span className={`font-display border-2 px-1.5 text-[10px] font-black ${meta.color}`} style={{ borderColor: "currentColor" }}>{meta.short}</span>
                        {meta.name}
                      </span>
                      <span className="font-mono text-[12px] text-ink2">
                        {st.solved}/{st.total} · {acc === null ? "—" : `точность ${acc}%`}
                      </span>
                    </div>
                    <div className="mt-2 h-3 overflow-hidden rounded-full border border-ink/15 bg-paper">
                      <div className={`h-full ${meta.bg} transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {atts.length === 0 && (
              <p className="mt-5 border-t border-dashed border-ink/20 pt-4 text-[13px] text-ink2">
                Пока нет попыток — статистика оживёт после первого решённого задания.
              </p>
            )}
          </div>
        </Reveal>

        {/* последние попытки */}
        <Reveal delay={120}>
          <div className="sheet h-full p-6">
            <h2 className="font-display text-lg font-bold">Последние попытки</h2>
            {derived.recent.length === 0 ? (
              <div className="mt-6 flex flex-col items-center py-8 text-center">
                <Icon name="chart" size={34} className="text-ink/25" />
                <p className="mt-3 max-w-[220px] text-[13px] leading-relaxed text-ink2">Журнал попыток появится после первого решения.</p>
                <button onClick={() => onNav({ name: "bank" })} className="btn btn-ghost mt-4 px-4 py-2 text-[13px]">Начать решать</button>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {derived.recent.map((a, i) => {
                  const t = taskById(a.taskId);
                  if (!t) return null;
                  return (
                    <li key={i}>
                      <button
                        onClick={() => onNav({ name: "task", id: a.taskId })}
                        className="group flex w-full items-center gap-3 border border-ink/10 px-3 py-2 text-left transition hover:border-ink/35 hover:bg-sheet"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${a.correct ? "bg-green/15 text-green" : "bg-red/12 text-red"}`}>
                          <Icon name={a.correct ? "check" : "x"} size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{t.topic}</span>
                          <span className="font-mono text-[10px] text-ink2">{SUBJECTS[t.subject].short} · {formatDay(a.ts)} · {formatClock(a.seconds)}</span>
                        </span>
                        <Icon name="arrowR" size={14} className="text-ink2 transition group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Reveal>
      </div>

      <Reveal delay={150}>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-2 border-dashed border-ink/25 bg-sheet px-5 py-4">
          <p className="text-[13px] text-ink2">
            {isGuestMode ? "Прогресс хранится локально в твоём браузере и не отправляется никуда." : "Прогресс синхронизируется с твоим аккаунтом."}
          </p>
          {confirming ? (
            <span className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-red">Точно стереть всё?</span>
              <button onClick={() => { resetAll(); setConfirming(false); }} className="btn btn-red px-4 py-2 text-[12px]">Да, стереть</button>
              <button onClick={() => setConfirming(false)} className="btn btn-ghost px-4 py-2 text-[12px]">Отмена</button>
            </span>
          ) : (
            <button onClick={() => setConfirming(true)} className="btn btn-ghost px-4 py-2 text-[12px]">
              <Icon name="trash" size={14} /> Сбросить прогресс
            </button>
          )}
        </div>
      </Reveal>
    </div>
  );
}

/* ─────────── Полная страница репетитора ─────────── */
export function TutorView({ onNav }: { onNav: (v: View) => void }) {
  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">кабинет репетитора</p>
          <h1 className="font-display mt-1 text-3xl font-black leading-tight sm:text-4xl">
            Спрашивай — <span className="hl">как на уроке</span>
          </h1>
          <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-ink2">
            Репетитор знает все задания банка, твою тетрадь ошибок и структуру ЕГЭ. Отвечает по делу: правило, пример, ловушки экзамена.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              { i: "bulb", t: "Подсказки ступенями", d: "Открой задание в банке — репетитор ведёт к ответу, не раскрывая решения." },
              { i: "book", t: "Теория коротко", d: "Логарифмы, паронимы, Н/НН, двоичный код, логика, рынок — всё в одной реплике." },
              { i: "target", t: "Разбор твоих ошибок", d: "Напиши «мои ошибки» — получишь карту слабых мест и план действий." },
              { i: "list", t: "План подготовки", d: "Недельная схема 15+15+10 и стратегия на сам экзамен." },
            ].map((f) => (
              <li key={f.t} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-ink bg-hl">
                  <Icon name={f.i} size={17} />
                </span>
                <div>
                  <p className="text-[14px] font-extrabold">{f.t}</p>
                  <p className="text-[12.5px] leading-relaxed text-ink2">{f.d}</p>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={() => onNav({ name: "bank" })} className="btn btn-ink mt-7 px-5 py-2.5 text-sm">
            Открыть задание и решать вместе <Icon name="arrowR" size={16} />
          </button>
        </div>
        <Reveal>
          <TutorChat onNavigate={(d) => onNav({ name: d } as View)} />
        </Reveal>
      </div>
    </div>
  );
}
