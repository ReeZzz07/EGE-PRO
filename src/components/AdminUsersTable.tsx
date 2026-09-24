// Админка → «Пользователи»: таблица с поиском (id, email, имя), фильтрами воронки с инверсией и
// пагинацией; карточка пользователя открывается в модальном окне. Правка и действия с персональными
// данными — в UserDetailPanel (AdminUsers.tsx).
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  activeFilterCount,
  EMPTY_USER_FILTERS,
  loadAdminUserFacets,
  searchAdminUsers,
  type AdminUserFacets,
  type AdminUserFilters,
  type AdminUserListItem,
  type UserSortKey,
} from "../lib/adminUsers";
import AdminUserFilterPanel, { describeFilters } from "./AdminUserFilterPanel";
import { UserDetailPanel, StatusBadge } from "./AdminUsers";
import { fmtDate, UserModal } from "./AdminUserCard";
import AdminCampaignComposer from "./AdminCampaignComposer";
import { Icon } from "./ui";

const PAGE_SIZE = 25;

/** Значок шага воронки: пройден (бирюзовый) / не пройден (пунктир) / брошена оплата (жёлтый «!»). */
function StepDot({ state, label }: { state: "yes" | "no" | "warn"; label: string }) {
  const cls =
    state === "yes" ? "border-teal bg-teal text-white" : state === "warn" ? "border-amber bg-amber/15 text-amber" : "border-dashed border-ink/25 bg-transparent text-transparent";
  return (
    <span title={label} aria-label={label} role="img" className={`inline-flex h-6 w-6 items-center justify-center border-2 ${cls}`}>
      {state === "warn" ? <span className="text-[13px] font-black leading-none">!</span> : <Icon name="check" size={12} />}
    </span>
  );
}

function SortTh({ label, sortKey, sort, dir, onSort, className = "" }: { label: string; sortKey: UserSortKey; sort: UserSortKey; dir: "asc" | "desc"; onSort: (k: UserSortKey) => void; className?: string }) {
  const active = sort === sortKey;
  return (
    <th className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] transition hover:text-ink ${active ? "text-ink" : "text-ink2"}`}>
        {label}
        <span aria-hidden className={active ? "text-blue" : "text-ink/25"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

export default function AdminUsersTable() {
  const { profile } = useAuth();
  const [filters, setFilters] = useState<AdminUserFilters>(EMPTY_USER_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [facets, setFacets] = useState<AdminUserFacets>({ regions: [], cities: [] });
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<UserSortKey>("registered");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [overall, setOverall] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    loadAdminUserFacets().then(setFacets);
  }, []);

  const refresh = useCallback(() => {
    const req = ++requestRef.current;
    setLoading(true);
    searchAdminUsers(filters, page, PAGE_SIZE, sort, dir)
      .then((res) => {
        if (req !== requestRef.current) return; // устаревший ответ (фильтры уже поменялись)
        setRows(res.rows);
        setTotal(res.total);
        setOverall(res.overall);
        setError(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (req !== requestRef.current) return;
        setError(e.message || "Не удалось загрузить список");
        setLoading(false);
      });
  }, [filters, page, sort, dir]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const closeModal = useCallback(() => setSelectedId(null), []);
  const closeComposer = useCallback(() => setComposing(false), []);

  if (!profile) return null;

  const changeFilters = (next: AdminUserFilters) => {
    setPage(0);
    setFilters(next);
  };
  const onSort = (k: UserSortKey) => {
    setPage(0);
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "registered" ? "desc" : "asc");
    }
  };

  const chips = describeFilters(filters);
  const nFilters = activeFilterCount(filters);
  const hasAny = nFilters > 0 || filters.q.trim() !== "";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Пользователи</h2>
          <p className="mt-1 text-[12.5px] text-ink2">Воронка по каждому ученику, тариф, персональные скидки и действия с персональными данными по 152-ФЗ.</p>
        </div>
        <p className="font-mono text-[12px] text-ink2" aria-live="polite">
          {loading && rows.length === 0 ? "…" : hasAny ? <>Найдено <strong className="text-ink">{total}</strong> из {overall}</> : <>Всего: <strong className="text-ink">{overall}</strong></>}
        </p>
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> список пользователей не загрузится.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1 sm:max-w-md">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink2">
            <Icon name="search" size={15} />
          </span>
          <input
            value={filters.q}
            onChange={(e) => changeFilters({ ...filters, q: e.target.value })}
            placeholder="Поиск по id, email или имени…"
            aria-label="Поиск по id, email или имени"
            className="input-blank w-full rounded-sm px-3 py-2 pl-9 pr-9 text-[13px]"
          />
          {filters.q && (
            <button onClick={() => changeFilters({ ...filters, q: "" })} aria-label="Очистить поиск" className="absolute inset-y-0 right-2 flex items-center px-1 text-ink2 hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`btn px-3.5 py-2 text-[12.5px] ${showFilters || nFilters > 0 ? "btn-ink" : "btn-ghost"}`}
        >
          <Icon name="list" size={14} /> Фильтры
          {nFilters > 0 && <span className="ml-1 rounded-sm bg-hl px-1.5 font-mono text-[11px] font-black text-ink">{nFilters}</span>}
        </button>
        {hasAny && (
          <button onClick={() => changeFilters(EMPTY_USER_FILTERS)} className="btn btn-ghost px-3 py-2 text-[12.5px]">
            <Icon name="refresh" size={13} /> Сбросить всё
          </button>
        )}
        <button onClick={() => setComposing(true)} className="btn btn-blue ml-auto px-3.5 py-2 text-[12.5px]" title="Письмо тем, кто подходит под текущие фильтры и поиск">
          <Icon name="send" size={13} /> Написать по фильтру
        </button>
      </div>

      {showFilters && (
        <div className="mt-3">
          <AdminUserFilterPanel filters={filters} facets={facets} onChange={changeFilters} />
        </div>
      )}

      {chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Включённые фильтры">
          {chips.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => changeFilters(c.clear(filters))}
                aria-label={`Убрать фильтр: ${c.text}`}
                className="group inline-flex items-center gap-1.5 rounded-sm border-2 border-ink/25 bg-paper px-2 py-1 text-[12px] font-semibold transition hover:border-red/60"
              >
                {c.text}
                <Icon name="x" size={11} className="text-ink2 group-hover:text-red" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-4 border-l-4 border-red bg-red/8 px-4 py-3 text-[13px] font-bold text-red">
          {error}
        </p>
      )}

      <div className="relative mt-4 overflow-x-auto border-2 border-ink/15">
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <thead className="bg-sheet">
            <tr className="border-b-2 border-ink/15">
              <SortTh label="Пользователь" sortKey="name" sort={sort} dir={dir} onSort={onSort} className="bg-sheet px-3.5 py-2.5 lg:sticky lg:left-0 lg:z-[1]" />
              <th className="px-3 py-2.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink2">Регион · город</th>
              <SortTh label="Регистрация" sortKey="registered" sort={sort} dir={dir} onSort={onSort} className="px-3 py-2.5" />
              <SortTh label="Тариф" sortKey="tariff" sort={sort} dir={dir} onSort={onSort} className="px-3 py-2.5" />
              {["Почта", "Онбординг", "Диагностика", "1-я задача", "ИИ", "Оплата"].map((h) => (
                <th key={h} className="px-1.5 py-2.5 text-center font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink2">
                  {h}
                </th>
              ))}
              <th className="px-3 py-2.5">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y-2 divide-ink/10 transition-opacity ${loading && rows.length > 0 ? "opacity-50" : ""}`}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center">
                  {loading ? (
                    <span className="font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</span>
                  ) : (
                    <>
                      <p className="text-[13.5px] font-bold">Никого не нашлось</p>
                      <p className="mt-1 text-[12.5px] text-ink2">Попробуй изменить условия или инвертировать фильтр.</p>
                      {hasAny && (
                        <button onClick={() => changeFilters(EMPTY_USER_FILTERS)} className="btn btn-ghost mt-3 px-3.5 py-2 text-[12.5px]">
                          Сбросить фильтры
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((u) => {
                const name = u.full_name || u.email;
                return (
                  <tr key={u.id} onClick={() => setSelectedId(u.id)} className="group cursor-pointer bg-paper transition hover:bg-hl/40">
                    <td className="bg-paper px-3.5 py-2.5 group-hover:bg-[#f7f2c8] lg:sticky lg:left-0 lg:z-[1]">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-ink bg-ink font-display text-[14px] font-black text-hl">
                          {(name || "?").trim().charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="max-w-[220px] truncate text-[13.5px] font-bold">{name}</span>
                            {u.is_admin && <span className="rounded-sm border-2 border-ink bg-hl px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">админ</span>}
                            {u.discount_percent != null && <span className="rounded-sm border-2 border-teal bg-teal/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal">−{u.discount_percent}%</span>}
                          </div>
                          <p className="max-w-[260px] truncate font-mono text-[11px] text-ink2">{u.email}</p>
                          <p className="font-mono text-[10px] text-ink/40" title={u.id}>
                            id {u.id.slice(0, 8)}…
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      {u.city || u.region ? (
                        <>
                          <p className="font-semibold">{u.city || "—"}</p>
                          <p className="text-[11.5px] text-ink2">{u.region && u.region !== u.city ? u.region : ""}</p>
                        </>
                      ) : (
                        <span className="text-ink/30">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px]">{fmtDate(u.registered_at)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge user={u} />
                      {u.tariff_id !== "free" && <p className="mt-1 font-mono text-[10.5px] text-ink2">до {fmtDate(u.tariff_expires_at)}</p>}
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot state={u.confirmed ? "yes" : "no"} label={u.confirmed ? "Почта подтверждена" : "Почта не подтверждена"} />
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot state={u.onboarded ? "yes" : "no"} label={u.onboarded ? "Онбординг пройден" : "Онбординг не пройден"} />
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot state={u.diagnostic ? "yes" : "no"} label={u.diagnostic ? "Диагностика пройдена" : "Диагностику не проходил"} />
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot state={u.first_task ? "yes" : "no"} label={u.first_task ? "Решал задачи" : "Не решал задач"} />
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot state={u.ai_request ? "yes" : "no"} label={u.ai_request ? "Обращался к ИИ-репетитору" : "Не обращался к ИИ-репетитору"} />
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      <StepDot
                        state={u.paid ? "yes" : u.abandoned ? "warn" : "no"}
                        label={u.paid ? "Есть успешный платёж" : u.abandoned ? "Начал платёж, но не завершил" : "Платежей не было"}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(u.id);
                        }}
                        aria-label={`Открыть карточку: ${name}`}
                        className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-[12px]"
                      >
                        <Icon name="eye" size={13} /> Карточка
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11.5px] text-ink2">
            Показано {from}–{to} из {total}
          </p>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-3">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-40">
                ← Назад
              </button>
              <span className="font-mono text-[12px] text-ink2">
                {page + 1} / {pages}
              </span>
              <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="btn btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-40">
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}

      {composing && (
        <UserModal onClose={closeComposer}>
          <AdminCampaignComposer filters={filters} onApplyFilters={changeFilters} onClose={closeComposer} />
        </UserModal>
      )}

      {selectedId && (
        <UserModal onClose={closeModal}>
          <UserDetailPanel id={selectedId} ownId={profile.id} onChanged={refresh} onClose={closeModal} />
        </UserModal>
      )}
    </div>
  );
}
