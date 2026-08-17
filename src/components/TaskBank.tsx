import { useMemo, useState } from "react";
import { DIFF_LABEL, SUBJECTS, TASKS, type EgeTask, type Subject } from "../data/tasks";
import { useProgress } from "../lib/store";
import { plural } from "../lib/utils";
import type { View } from "./Header";
import { Icon, Reveal } from "./ui";

type Status = "all" | "new" | "solved" | "mistake";

export default function TaskBank({ onNav }: { onNav: (v: View) => void }) {
  const { derived } = useProgress();
  const [subject, setSubject] = useState<Subject | "all">("all");
  const [diff, setDiff] = useState<0 | 1 | 2 | 3>(0);
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TASKS.filter((t) => {
      if (subject !== "all" && t.subject !== subject) return false;
      if (diff && t.difficulty !== diff) return false;
      if (status === "new" && (derived.solvedIds.has(t.id) || derived.mistakeIds.has(t.id))) return false;
      if (status === "solved" && !derived.solvedIds.has(t.id)) return false;
      if (status === "mistake" && !derived.mistakeIds.has(t.id)) return false;
      if (q && !(`${t.topic} ${t.statement.join(" ")} ${t.fipiId}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [subject, diff, status, query, derived]);

  const statusOf = (t: EgeTask): "solved" | "mistake" | "new" =>
    derived.solvedIds.has(t.id) ? "solved" : derived.mistakeIds.has(t.id) ? "mistake" : "new";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
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
          <div className="flex items-center gap-1.5">
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
          <div className="flex items-center gap-1.5">
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
      {filtered.length === 0 ? (
        <div className="sheet mt-6 flex flex-col items-center px-6 py-16 text-center">
          <Icon name="search" size={40} className="text-ink/25" />
          <p className="font-display mt-4 text-lg font-bold">Ничего не нашлось</p>
          <p className="mt-1 max-w-sm text-sm text-ink2">Попробуй сбросить фильтры или изменить запрос — в банке {TASKS.length} заданий по пяти предметам.</p>
          <button
            onClick={() => { setSubject("all"); setDiff(0); setStatus("all"); setQuery(""); }}
            className="btn btn-ghost mt-5 px-4 py-2 text-sm"
          >
            <Icon name="refresh" size={15} /> Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t, i) => {
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
                    ) : (
                      <span className="rounded-sm border border-ink/25 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink2">№ {t.fipiId}</span>
                    )}
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
    </div>
  );
}
