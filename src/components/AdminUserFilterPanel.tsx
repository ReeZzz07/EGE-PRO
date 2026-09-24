// Панель фильтров списка пользователей (Админка → Пользователи). Каждый фильтр воронки — переключатель
// «Все / Да / Нет»: «Да» — условие выполнено, «Нет» — инверсия (условие НЕ выполнено, противоположный
// список). Регион и город — значение из справочника (или своё для города) и переключатель «Только / Кроме».
import { useMemo } from "react";
import { USER_FUNNEL_FILTERS, type AdminUserFacets, type AdminUserFilters, type TriState } from "../lib/adminUsers";
import { Icon } from "./ui";

interface Props {
  filters: AdminUserFilters;
  facets: AdminUserFacets;
  onChange: (next: AdminUserFilters) => void;
}

const TRI: { v: TriState; label: string; on: string }[] = [
  { v: "any", label: "Все", on: "bg-ink text-paper border-ink" },
  { v: "yes", label: "Да", on: "bg-teal text-white border-teal" },
  { v: "no", label: "Нет", on: "bg-rose text-white border-rose" },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; on: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-sm border-2 border-ink/20">
      {options.map((o, i) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-[12px] font-bold transition ${i > 0 ? "border-l-2 border-ink/20" : ""} ${active ? `${o.on} border-y-0` : "bg-paper text-ink2 hover:bg-hl/50"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function describeFilters(f: AdminUserFilters): { id: string; text: string; clear: (f: AdminUserFilters) => AdminUserFilters }[] {
  const chips: { id: string; text: string; clear: (f: AdminUserFilters) => AdminUserFilters }[] = [];
  for (const def of USER_FUNNEL_FILTERS) {
    const v = f.funnel[def.key];
    if (v === "any") continue;
    chips.push({
      id: def.key,
      text: `${def.label}: ${v === "yes" ? "да" : "нет"}`,
      clear: (cur) => ({ ...cur, funnel: { ...cur.funnel, [def.key]: "any" } }),
    });
  }
  if (f.region) chips.push({ id: "region", text: `${f.regionNot ? "Не из региона" : "Регион"}: ${f.region}`, clear: (cur) => ({ ...cur, region: "", regionNot: false }) });
  if (f.city) chips.push({ id: "city", text: `${f.cityNot ? "Не из города" : "Город"}: ${f.city}`, clear: (cur) => ({ ...cur, city: "", cityNot: false }) });
  return chips;
}

export default function AdminUserFilterPanel({ filters, facets, onChange }: Props) {
  const set = (patch: Partial<AdminUserFilters>) => onChange({ ...filters, ...patch });

  // подсказки городов сужаем по выбранному региону
  const cityOptions = useMemo(() => {
    const list = filters.region ? facets.cities.filter((c) => (c.region ?? "").toLowerCase() === filters.region.toLowerCase()) : facets.cities;
    return list.slice(0, 200);
  }, [facets.cities, filters.region]);

  const onlyExcept = [
    { v: "only", label: "Только", on: "bg-teal text-white border-teal" },
    { v: "except", label: "Кроме", on: "bg-rose text-white border-rose" },
  ] as const;

  return (
    <div className="border-2 border-ink/15 bg-sheet p-4 sm:p-5">
      <p className="text-[12px] leading-relaxed text-ink2">
        <strong className="text-ink">Как работают фильтры:</strong> «Да» — покажет тех, у кого условие выполнено; «Нет» — инверсия, покажет всех остальных. Условия складываются (И).
      </p>

      <div className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2 xl:grid-cols-3">
        {USER_FUNNEL_FILTERS.map((def) => (
          <div key={def.key} className="flex items-center justify-between gap-3" title={def.hint}>
            <span className="text-[13px] font-semibold leading-tight">{def.label}</span>
            <Segmented value={filters.funnel[def.key]} options={TRI} label={def.label} onChange={(v) => set({ funnel: { ...filters.funnel, [def.key]: v } })} />
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 border-t-2 border-dashed border-ink/15 pt-4 md:grid-cols-2">
        <div>
          <label htmlFor="user-filter-region" className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Регион
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <select
              id="user-filter-region"
              value={filters.region}
              onChange={(e) => set({ region: e.target.value, ...(e.target.value ? {} : { regionNot: false }) })}
              className="input-blank min-w-0 flex-1 rounded-sm px-3 py-2 text-[13px]"
            >
              <option value="">Любой</option>
              {facets.regions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value} ({r.count})
                </option>
              ))}
            </select>
            <Segmented value={filters.regionNot ? "except" : "only"} options={[...onlyExcept]} label="Режим фильтра по региону" onChange={(v) => set({ regionNot: v === "except" })} />
          </div>
        </div>

        <div>
          <label htmlFor="user-filter-city" className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Город
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              id="user-filter-city"
              list="user-filter-city-options"
              value={filters.city}
              onChange={(e) => set({ city: e.target.value, ...(e.target.value ? {} : { cityNot: false }) })}
              placeholder="Выбери из списка или впиши"
              className="input-blank min-w-0 flex-1 rounded-sm px-3 py-2 text-[13px]"
            />
            <datalist id="user-filter-city-options">
              {cityOptions.map((c) => (
                <option key={`${c.region}-${c.value}`} value={c.value} />
              ))}
            </datalist>
            <Segmented value={filters.cityNot ? "except" : "only"} options={[...onlyExcept]} label="Режим фильтра по городу" onChange={(v) => set({ cityNot: v === "except" })} />
            {filters.city && (
              <button onClick={() => set({ city: "", cityNot: false })} aria-label="Очистить город" className="btn btn-ghost px-2 py-2">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
