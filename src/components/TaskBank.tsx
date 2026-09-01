import { useEffect, useMemo, useRef, useState } from "react";
import { DIFF_LABEL, SUBJECTS, TASKS, type EgeTask, type Subject } from "../data/tasks";
import { useProgress } from "../lib/store";
import { plural } from "../lib/utils";
import { hydrateSubjectTasks, isSubjectLoading, useTasksVersion } from "../lib/dbTasks";
import { DEFAULT_FILTERS, filterTasks, loadTaskBankFilters, saveTaskBankFilters, type TaskStatus } from "../lib/taskFilters";
import type { View } from "./Header";
import { Icon, Reveal } from "./ui";

const PAGE_SIZE = 30;

/** Список номеров страниц для рендера пагинации: первая, последняя, окно вокруг текущей,
 *  остальное схлопывается в null («…»). Все индексы 0-based. */
function pageWindow(current: number, total: number): (number | null)[] {
  const near = new Set<number>();
  for (let i = current - 1; i <= current + 1; i++) if (i >= 0 && i < total) near.add(i);
  near.add(0);
  near.add(total - 1);
  const sorted = [...near].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) result.push(null);
    result.push(p);
    prev = p;
  }
  return result;
}

export default function TaskBank({ onNav, initialSubject }: { onNav: (v: View) => void; initialSubject?: Subject }) {
  const { derived } = useProgress();
  useTasksVersion();
  // initialSubject явно задан (клик по предмету на дашборде/лендинге) — это новый осознанный
  // выбор, начинаем с чистых фильтров. Иначе (например, вернулись по ссылке «Банк заданий» из
  // решения задания) — восстанавливаем фильтры, с которыми ушли в прошлый раз.
  const initial = useMemo(() => (initialSubject ? { ...DEFAULT_FILTERS, subject: initialSubject } : loadTaskBankFilters()), [initialSubject]);
  const [subject, setSubject] = useState<Subject | "all">(initial.subject);
  const [diff, setDiff] = useState<0 | 1 | 2 | 3>(initial.diff);
  const [status, setStatus] = useState<TaskStatus>(initial.status);
  const [query, setQuery] = useState(initial.query);
  const [page, setPage] = useState(0);

  useEffect(() => {
    saveTaskBankFilters({ subject, diff, status, query });
  }, [subject, diff, status, query]);

  useEffect(() => {
    if (subject !== "all") hydrateSubjectTasks(subject);
  }, [subject]);

  const loading = subject !== "all" && isSubjectLoading(subject);

  const filtered = useMemo(() => filterTasks({ subject, diff, status, query }, derived), [subject, diff, status, query, derived]);

  // сброс на первую страницу при смене фильтров — иначе после «поиска» можно застрять
  // на несуществующей странице 40 из 2
  useEffect(() => {
    setPage(0);
  }, [subject, diff, status, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE);

  const goToPage = (p: number) => setPage(Math.max(0, Math.min(totalPages - 1, p)));

  // скроллим к началу сетки ПОСЛЕ того, как React уже отрисовал укороченную страницу — если
  // дёргать scrollIntoView сразу в обработчике клика, он ещё видит старый (длинный) DOM и после
  // рендера браузер обрежет скролл под новую высоту, и страница останется внизу
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    document.getElementById("task-grid-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageSafe]);

  const statusOf = (t: EgeTask): "solved" | "mistake" | "new" =>
    derived.solvedIds.has(t.id) ? "solved" : derived.mistakeIds.has(t.id) ? "mistake" : "new";

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">открытый банк · ФИПИ</p>
          <h1 className="font-display mt-1 text-3xl font-black sm:text-4xl">Банк заданий</h1>
        </div>
        <p className="text-sm font-semibold text-ink2">
          {filtered.length} {plural(filtered.length, "задание", "задания", "заданий")} · решено {derived.solvedIds.size} из {TASKS.length}
        </p>
      </div>

      {/* фильтры */}
      <div className="sheet mt-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSubject("all")}
            className={`border-2 px-3 py-1.5 text-[12.5px] font-bold transition ${subject === "all" ? "border-ink bg-ink text-paper" : "border-ink/20 bg-transparent text-ink2 hover:border-ink hover:text-ink"}`}
          >
            Все предметы
          </button>
          {Object.values(SUBJECTS).map((s) => (
            <button
              key={s.id}
              onClick={() => setSubject(subject === s.id ? "all" : s.id)}
              className={`border-2 px-3 py-1.5 text-[12.5px] font-bold transition ${
                subject === s.id ? "border-ink bg-ink text-paper" : "border-ink/20 text-ink2 hover:border-ink hover:text-ink"
              }`}
            >
              <span className={subject === s.id ? "text-hl" : s.color}>{s.short}</span> {s.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {([0, 1, 2, 3] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDiff(d)}
                className={`border-2 px-2.5 py-1 text-[12px] font-semibold transition ${diff === d ? "border-blue bg-blue text-white" : "border-ink/20 text-ink2 hover:border-blue hover:text-blue"}`}
              >
                {d === 0 ? "Любая сложность" : DIFF_LABEL[d]}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-ink/15 sm:block" />
          <div className="flex flex-wrap items-center gap-1.5">
            {([["all", "Все"], ["new", "Новые"], ["solved", "Решённые"], ["mistake", "С ошибкой"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={`border-2 px-2.5 py-1 text-[12px] font-semibold transition ${status === k ? "border-ink bg-hl text-ink" : "border-ink/20 text-ink2 hover:border-ink hover:text-ink"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: тема, условие, №…"
              className="input-blank w-full rounded-sm py-2 pl-9 pr-3 text-[13px] font-semibold"
            />
          </div>
        </div>
      </div>

      {/* сетка заданий */}
      <div id="task-grid-top" className="scroll-mt-20" />
      {loading && filtered.length === 0 ? (
        <div className="sheet mt-6 flex flex-col items-center px-6 py-16 text-center">
          <Icon name="refresh" size={32} className="animate-spin text-ink/40" />
          <p className="font-display mt-4 text-lg font-bold">Загружаем задания…</p>
          <p className="mt-1 max-w-sm text-sm text-ink2">Подгружаем банк по предмету «{SUBJECTS[subject as Subject].name}» — обычно это пара секунд.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="sheet mt-6 flex flex-col items-center px-6 py-16 text-center">
          <Icon name="search" size={40} className="text-ink/25" />
          <p className="font-display mt-4 text-lg font-bold">Ничего не нашлось</p>
          <p className="mt-1 max-w-sm text-sm text-ink2">Попробуй сбросить фильтры или изменить запрос — в банке {TASKS.length} заданий по {Object.keys(SUBJECTS).length} предметам.</p>
          <button
            onClick={() => { setSubject("all"); setDiff(0); setStatus("all"); setQuery(""); }}
            className="btn btn-ghost mt-5 px-4 py-2 text-sm"
          >
            <Icon name="refresh" size={15} /> Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pageItems.map((t, i) => {
            const st = statusOf(t);
            const meta = SUBJECTS[t.subject];
            return (
              <Reveal key={t.id} delay={(i % 6) * 60}>
                <button onClick={() => onNav({ name: "task", id: t.id })} className="sheet card-lift group flex h-full w-full flex-col p-5 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`font-display border-2 px-1.5 py-0.5 text-[10px] font-black ${meta.color}`} style={{ borderColor: "currentColor" }}>
                      {meta.short} · №{t.egeNumber}
                    </span>
                    {st === "solved" ? (
                      <span className="flex items-center gap-1 rounded-sm bg-green px-1.5 py-0.5 text-[10px] font-bold text-white"><Icon name="check" size={11} /> решено</span>
                    ) : st === "mistake" ? (
                      <span className="flex items-center gap-1 rounded-sm bg-red px-1.5 py-0.5 text-[10px] font-bold text-white"><Icon name="refresh" size={11} /> реванш</span>
                    ) : t.section ? (
                      <span
                        className="max-w-[60%] truncate rounded-sm border border-ink/25 px-1.5 py-0.5 text-[10px] font-semibold text-ink2"
                        title={`${t.section} · ${t.topic}`}
                      >
                        {t.section}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="font-display mt-3 text-[15px] font-bold leading-snug">{t.topic}</h3>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-relaxed text-ink2">{t.statement[0]}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-dashed border-ink/20 pt-3">
                    <span className="flex items-center gap-1.5" title={`Сложность: ${DIFF_LABEL[t.difficulty]}`}>
                      {[1, 2, 3].map((d) => (
                        <span key={d} className={`h-2 w-2 rotate-45 ${d <= t.difficulty ? (t.difficulty === 3 ? "bg-red" : t.difficulty === 2 ? "bg-amber" : "bg-green") : "bg-ink/15"}`} />
                      ))}
                      <span className="ml-1 font-mono text-[10px] uppercase text-ink2">{DIFF_LABEL[t.difficulty]}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-[11px] font-bold text-blue">{t.points} п.б.</span>
                      <Icon name="arrowR" size={16} className="text-ink2 transition group-hover:translate-x-1 group-hover:text-blue" />
                    </span>
                  </div>
                </button>
              </Reveal>
            );
          })}
        </div>
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
          <button
            onClick={() => goToPage(pageSafe - 1)}
            disabled={pageSafe === 0}
            className="btn btn-ghost px-3 py-2 text-[12.5px] disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon name="arrowL" size={14} /> Назад
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {pageWindow(pageSafe, totalPages).map((p, i) =>
              p === null ? (
                <span key={`gap-${i}`} className="px-1.5 font-mono text-[12px] text-ink2">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`min-w-[34px] rounded-sm border-2 px-2.5 py-1.5 font-mono text-[12.5px] font-bold transition ${
                    p === pageSafe ? "border-ink bg-ink text-paper" : "border-ink/20 text-ink2 hover:border-ink hover:text-ink"
                  }`}
                >
                  {p + 1}
                </button>
              )
            )}
          </div>
          <button
            onClick={() => goToPage(pageSafe + 1)}
            disabled={pageSafe >= totalPages - 1}
            className="btn btn-ghost px-3 py-2 text-[12.5px] disabled:pointer-events-none disabled:opacity-30"
          >
            Вперёд <Icon name="arrowR" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
