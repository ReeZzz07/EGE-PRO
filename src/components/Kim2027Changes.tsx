// Справочная страница "Изменения ЕГЭ 2027" — по официальному проекту ФИПИ (см. data/kim2027.ts).
// Только структура/описание, без нового контента заданий: реальные новые типы заданий появятся
// в банке отдельно, когда КИМ будет утверждён (ориентировочно ноябрь 2026).
import { SUBJECTS, type Subject } from "../data/tasks";
import { ALL_SUBJECTS } from "../lib/dbTasks";
import { KIM_2027_CHANGES, KIM_2027_STATUS_NOTE } from "../data/kim2027";
import { Icon } from "./ui";

const CHANGED_FIRST = [...ALL_SUBJECTS].sort((a, b) => {
  const ca = KIM_2027_CHANGES[a].changed ? 0 : 1;
  const cb = KIM_2027_CHANGES[b].changed ? 0 : 1;
  return ca - cb;
});

function SubjectCard({ subject }: { subject: Subject }) {
  const meta = SUBJECTS[subject];
  const change = KIM_2027_CHANGES[subject];

  return (
    <div className={`sheet p-5 ${change.changed ? "border-2 border-amber/40" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] font-bold ${meta.color}`}>{meta.short}</span>
          <h3 className="font-display text-base font-bold">{meta.name}</h3>
        </div>
        <span
          className={`rounded-sm px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] ${
            change.changed ? "bg-amber/15 text-amber" : "bg-ink/5 text-ink2"
          }`}
        >
          {change.changed ? "есть изменения" : "без изменений"}
        </span>
      </div>

      {change.changed && (
        <>
          {(change.taskCount || change.maxPrimary) && (
            <div className="mt-3 flex flex-wrap gap-4 font-mono text-[12px] text-ink2">
              {change.taskCount && (
                <span>
                  Заданий: <strong className="text-ink">{change.taskCount.before}</strong> →{" "}
                  <strong className="text-ink">{change.taskCount.after}</strong>
                </span>
              )}
              {change.maxPrimary && (
                <span>
                  Макс. первичный балл: <strong className="text-ink">{change.maxPrimary.before}</strong> →{" "}
                  <strong className="text-ink">{change.maxPrimary.after}</strong>
                </span>
              )}
            </div>
          )}
          <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-ink/90">
            {change.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                {p}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Kim2027Changes() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10">
      <div className="max-w-3xl">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-amber">проект фипи · на 2027 год</p>
        <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Что меняется в ЕГЭ 2027</h1>

        <p className="mt-4 flex gap-2.5 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-amber" />
          <span>{KIM_2027_STATUS_NOTE}</span>
        </p>

        <p className="mt-5 text-[13px] leading-relaxed text-ink2">
          Реальные структурные изменения затронули только 3 предмета из 12 — математику (профиль), историю и информатику.
          У остальных предметов структура заданий не меняется.
        </p>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {CHANGED_FIRST.map((s) => (
          <SubjectCard key={s} subject={s} />
        ))}
      </div>

      <p className="mt-6 font-mono text-[11px] text-ink2">
        Источник: fipi.ru, «План изменений КИМ ЕГЭ по учебным предметам в 2027 году».
      </p>
    </div>
  );
}
