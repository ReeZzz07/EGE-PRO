// Админка → «Пользователи»: поиск/просмотр карточки, тариф и срок его действия, персональная
// скидка, и действия, которые требует 152-ФЗ по запросу субъекта персональных данных — полная
// выгрузка, анонимизация, удаление. Пишет/удаляет через docker/api (не PostgREST напрямую, см.
// src/lib/adminUsers.ts) — эти операции нужны привилегии выше, чем даёт RLS.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { SUBJECTS } from "../data/tasks";
import { loadAllTariffs, type Tariff } from "../lib/tariffs";
import { GRADE_OPTS, GOAL_OPTS, TIME_OPTS } from "./OnboardingFlow";
import {
  searchAdminUsers,
  loadAdminUserDetail,
  updateAdminUser,
  exportAdminUserData,
  anonymizeAdminUser,
  deleteAdminUser,
  type AdminUserListItem,
  type AdminUserDetail,
} from "../lib/adminUsers";
import { Icon, useToast } from "./ui";

const PAGE_SIZE = 20;

/** Код → подпись для полей анкеты онбординга (см. OnboardingFlow.tsx) — та же анкета, что видит
 *  ученик, но здесь только для чтения: значения приходят из профиля, который правит сам ученик на
 *  странице настроек, админ их тут не редактирует. */
const GRADE_LABELS: Record<string, string> = Object.fromEntries(GRADE_OPTS.map((o) => [o.v, o.l]));
const GOAL_LABELS: Record<string, string> = Object.fromEntries(GOAL_OPTS.map((o) => [o.v, o.l]));
const TIME_LABELS: Record<number, string> = Object.fromEntries(TIME_OPTS.map((o) => [o.v, o.l]));
const GENDER_LABELS: Record<string, string> = { m: "Мужской", f: "Женский" };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** <input type="date"> отдаёт "YYYY-MM-DD" без времени — трактуем как "тариф действует ПО КОНЕЦ
 *  этого дня", а не с полуночи, иначе выбор "сегодня" выглядел бы уже истёкшим сразу после сохранения. */
function dateInputToExpiresAt(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T23:59:59`).toISOString();
}

function expiresAtToDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function addDays(dateInputValue: string, days: number): string {
  const base = dateInputValue ? new Date(`${dateInputValue}T00:00:00`) : new Date();
  const from = base.getTime() > Date.now() ? base : new Date();
  from.setDate(from.getDate() + days);
  return from.toISOString().slice(0, 10);
}

function StatusBadge({ user }: { user: AdminUserListItem | AdminUserDetail }) {
  if (user.anonymized_at) return <span className="rounded-sm border-2 border-ink/30 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink2">анонимизирован</span>;
  if (user.tariff_id === "free") return <span className="rounded-sm border-2 border-ink/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-ink2">free</span>;
  if (user.tariff_active) return <span className="rounded-sm border-2 border-blue bg-blue/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-blue">оплачен</span>;
  return <span className="rounded-sm border-2 border-red bg-red/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-red">истёк</span>;
}

function UserDetailPanel({ id, ownId, onChanged, onClose }: { id: string; ownId: string; onChanged: () => void; onClose: () => void }) {
  const { push } = useToast();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingAnonymize, setConfirmingAnonymize] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [tariffId, setTariffId] = useState("free");
  const [expiresAt, setExpiresAt] = useState("");
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAdminUserDetail(id), loadAllTariffs()]).then(([d, t]) => {
      setDetail(d);
      setTariffs(t);
      if (d) {
        setFullName(d.full_name ?? "");
        setEmail(d.email);
        setTariffId(d.tariff_id);
        setExpiresAt(expiresAtToDateInput(d.tariff_expires_at));
        setDiscountPercent(d.discount_percent != null ? String(d.discount_percent) : "");
        setIsAdmin(d.is_admin);
      }
      setLoading(false);
    });
  }, [id]);

  if (loading) return <p className="py-6 text-center font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Загрузка карточки…</p>;
  if (!detail) return <p className="py-6 text-center text-[13px] text-ink2">Пользователь не найден.</p>;

  const isSelf = id === ownId;
  const anonymized = !!detail.anonymized_at;

  const save = async () => {
    setSaving(true);
    const res = await updateAdminUser(id, {
      fullName: fullName.trim(),
      email: email.trim(),
      tariffId,
      tariffExpiresAt: dateInputToExpiresAt(expiresAt),
      discountPercent: discountPercent === "" ? null : Math.max(0, Math.min(100, Number(discountPercent) || 0)),
      ...(isSelf ? {} : { isAdmin }),
    });
    setSaving(false);
    if (res.error) return push(res.error, "err");
    push("Сохранено", "ok");
    onChanged();
  };

  const doExport = async () => {
    setExporting(true);
    const res = await exportAdminUserData(id);
    setExporting(false);
    if (res.error) push(res.error, "err");
    else push("Файл со всеми данными пользователя скачан", "ok");
  };

  const doAnonymize = async () => {
    setAnonymizing(true);
    const res = await anonymizeAdminUser(id);
    setAnonymizing(false);
    setConfirmingAnonymize(false);
    if (res.error) return push(res.error, "err");
    push("Персональные данные аккаунта анонимизированы", "ok");
    onChanged();
  };

  const doDelete = async () => {
    setDeleting(true);
    const res = await deleteAdminUser(id);
    setDeleting(false);
    if (res.error) return push(res.error, "err");
    push("Аккаунт удалён", "ok");
    onClose();
    onChanged();
  };

  const selectedTariff = tariffs.find((t) => t.id === tariffId);

  return (
    <div className="border-t-2 border-ink/15 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[15px] font-bold">{detail.full_name || "Без имени"}</span>
            <StatusBadge user={detail} />
            {detail.is_admin && <span className="rounded-sm border-2 border-ink bg-hl px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">админ</span>}
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-ink2">
            {detail.email} · регистрация {fmtDate(detail.registered_at)} · id: {detail.id}
          </p>
        </div>
        <button onClick={onClose} className="btn btn-ghost px-3 py-1.5 text-[12px]">
          <Icon name="x" size={13} /> Закрыть
        </button>
      </div>

      {isSelf && (
        <p className="mt-3 border-l-4 border-amber bg-amber/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Это твой собственный аккаунт — права администратора, анонимизация и удаление здесь недоступны. Используй настройки аккаунта.
        </p>
      )}

      {anonymized && (
        <p className="mt-3 border-l-4 border-ink/30 bg-ink/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Данные анонимизированы {fmtDate(detail.anonymized_at)} — вход в аккаунт заблокирован, email/имя стёрты. Экспорт и повторная анонимизация недоступны.
        </p>
      )}

      <div className="mt-4">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Результат онбординга</p>
        {detail.onboarded_at ? (
          <div className="mt-2 grid gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
            <p><span className="text-ink2">Класс:</span> <strong>{(detail.grade && GRADE_LABELS[detail.grade]) || "—"}</strong></p>
            <p><span className="text-ink2">Сдаёт ЕГЭ:</span> <strong>{detail.exam_year ?? "—"}</strong></p>
            <p><span className="text-ink2">Основной предмет:</span> <strong>{detail.primary_subject ? (SUBJECTS[detail.primary_subject as keyof typeof SUBJECTS]?.name ?? detail.primary_subject) : "—"}</strong></p>
            <p><span className="text-ink2">Цель:</span> <strong>{(detail.goal && GOAL_LABELS[detail.goal]) || "—"}</strong></p>
            <p><span className="text-ink2">Время в день:</span> <strong>{detail.daily_minutes != null ? (TIME_LABELS[detail.daily_minutes] ?? `${detail.daily_minutes} мин`) : "—"}</strong></p>
            <p><span className="text-ink2">Пройден:</span> <strong>{fmtDate(detail.onboarded_at)}</strong></p>
          </div>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink2">Онбординг ещё не пройден.</p>
        )}
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">О себе</p>
        <div className="mt-2 grid gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
          <p><span className="text-ink2">Регион:</span> <strong>{detail.region || "—"}</strong></p>
          <p><span className="text-ink2">Город:</span> <strong>{detail.city || "—"}</strong></p>
          <p><span className="text-ink2">Школа:</span> <strong>{detail.school || "—"}</strong></p>
          <p><span className="text-ink2">Возраст:</span> <strong>{detail.age ?? "—"}</strong></p>
          <p><span className="text-ink2">Пол:</span> <strong>{(detail.gender && GENDER_LABELS[detail.gender]) || "—"}</strong></p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Личные данные</p>
          <label className="block">
            <span className="text-[11.5px] font-bold text-ink2">Имя</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={anonymized} className="input-blank mt-1 w-full rounded-sm px-3 py-2 text-[13px] disabled:opacity-50" />
          </label>
          <label className="block">
            <span className="text-[11.5px] font-bold text-ink2">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={anonymized} className="input-blank mt-1 w-full rounded-sm px-3 py-2 text-[13px] disabled:opacity-50" />
          </label>

          <p className="pt-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Предметы ({detail.subjects.length})</p>
          {detail.subjects.length === 0 ? (
            <p className="text-[12.5px] text-ink2">Пока не выбраны.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.subjects.map((s) => (
                <span key={s.subject} className="rounded-sm border-2 border-ink/15 px-1.5 py-0.5 font-mono text-[10.5px] font-bold">
                  {SUBJECTS[s.subject as keyof typeof SUBJECTS]?.short ?? s.subject}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тариф и оплата</p>
          <label className="block">
            <span className="text-[11.5px] font-bold text-ink2">Тариф</span>
            <select value={tariffId} onChange={(e) => setTariffId(e.target.value)} className="input-blank mt-1 w-full rounded-sm px-3 py-2 text-[13px]">
              {tariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.priceRub > 0 ? `— ${t.priceRub.toLocaleString("ru-RU")} ₽/мес` : "— бесплатно"}
                </option>
              ))}
            </select>
          </label>

          {tariffId !== "free" && (
            <label className="block">
              <span className="text-[11.5px] font-bold text-ink2">Оплачено до (пусто — бессрочно)</span>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input-blank mt-1 w-full rounded-sm px-3 py-2 text-[13px]" />
              <div className="mt-1.5 flex gap-1.5">
                <button onClick={() => setExpiresAt(addDays(expiresAt, 30))} className="btn btn-ghost px-2.5 py-1 text-[11px]">+30 дней</button>
                <button onClick={() => setExpiresAt(addDays(expiresAt, 365))} className="btn btn-ghost px-2.5 py-1 text-[11px]">+365 дней</button>
                {expiresAt && <button onClick={() => setExpiresAt("")} className="btn btn-ghost px-2.5 py-1 text-[11px]">Сделать бессрочным</button>}
              </div>
              {detail.tariff_activated_at && <p className="mt-1 text-[11px] text-ink2">Тариф выдан {fmtDate(detail.tariff_activated_at)}</p>}
            </label>
          )}

          <label className="block">
            <span className="text-[11.5px] font-bold text-ink2">Персональная скидка, % (пусто — без скидки)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="без скидки"
              className="input-blank mt-1 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
            />
            {selectedTariff && selectedTariff.priceRub > 0 && discountPercent !== "" && (
              <p className="mt-1 text-[11.5px] text-ink2">
                Со скидкой: {Math.round(selectedTariff.priceRub * (1 - Math.max(0, Math.min(100, Number(discountPercent) || 0)) / 100)).toLocaleString("ru-RU")} ₽/мес
              </p>
            )}
          </label>

          {!isSelf && (
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4" />
              <span className="text-[13px] font-bold">Права администратора</span>
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn btn-blue px-4 py-2 text-[12.5px] disabled:opacity-50">
          <Icon name="check" size={13} /> {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        {!anonymized && (
          <button onClick={doExport} disabled={exporting} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
            <Icon name="download" size={13} /> {exporting ? "Готовим файл…" : "Скачать все данные (152-ФЗ)"}
          </button>
        )}
      </div>

      {!isSelf && (
        <div className="mt-6 border-t-2 border-dashed border-red/30 pt-4">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-red">опасная зона</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink2">
            По запросу пользователя на удаление персональных данных — анонимизация стирает email/имя/тексты сочинений и чата с ИИ, но сохраняет строки попыток
            для статистики; полное удаление стирает аккаунт целиком безвозвратно.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {!anonymized && !confirmingAnonymize && (
              <button onClick={() => setConfirmingAnonymize(true)} className="btn btn-red px-3.5 py-2 text-[12.5px]">
                <Icon name="eyeOff" size={13} /> Анонимизировать
              </button>
            )}
            {!confirmingDelete && (
              <button onClick={() => setConfirmingDelete(true)} className="btn btn-red px-3.5 py-2 text-[12.5px]">
                <Icon name="trash" size={13} /> Удалить аккаунт
              </button>
            )}
          </div>

          {confirmingAnonymize && (
            <div className="sheet mt-3 max-w-md border-red/40 p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold text-red"><Icon name="alert" size={14} /> Стереть персональные данные без возможности отмены?</p>
              <div className="mt-3 flex gap-2">
                <button onClick={doAnonymize} disabled={anonymizing} className="btn btn-red px-4 py-2 text-[12.5px]">{anonymizing ? "Анонимизируем…" : "Да, анонимизировать"}</button>
                <button onClick={() => setConfirmingAnonymize(false)} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">Отмена</button>
              </div>
            </div>
          )}
          {confirmingDelete && (
            <div className="sheet mt-3 max-w-md border-red/40 p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold text-red"><Icon name="alert" size={14} /> Удалить аккаунт и все его данные навсегда?</p>
              <div className="mt-3 flex gap-2">
                <button onClick={doDelete} disabled={deleting} className="btn btn-red px-4 py-2 text-[12.5px]">{deleting ? "Удаляем…" : "Да, удалить навсегда"}</button>
                <button onClick={() => setConfirmingDelete(false)} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminUsers() {
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    searchAdminUsers(query, page, PAGE_SIZE).then(({ rows, total }) => {
      setRows(rows);
      setTotal(total);
      setLoading(false);
    });
  };

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page]);

  if (!profile) return null;

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Пользователи</h2>
          <p className="mt-1 text-[12.5px] text-ink2">Тариф, срок оплаты, персональные скидки и действия с персональными данными по 152-ФЗ.</p>
        </div>
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> список пользователей не загрузится.
        </p>
      )}

      <div className="relative mt-4">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink2">
          <Icon name="search" size={15} />
        </span>
        <input
          value={query}
          onChange={(e) => {
            setPage(0);
            setQuery(e.target.value);
          }}
          placeholder="Email или имя…"
          className="input-blank w-full max-w-sm rounded-sm px-3 py-2 pl-9 text-[13px]"
        />
      </div>

      <div className="mt-4 divide-y-2 divide-ink/10 border-2 border-ink/15">
        {loading ? (
          <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink2">Никого не нашлось.</p>
        ) : (
          rows.map((u) => (
            <div key={u.id}>
              <button onClick={() => setSelectedId(selectedId === u.id ? null : u.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-3.5 text-left hover:bg-hl/60">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold">{u.full_name || u.email}</span>
                    <StatusBadge user={u} />
                    {u.is_admin && <span className="rounded-sm border-2 border-ink bg-hl px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">админ</span>}
                    {u.discount_percent != null && <span className="rounded-sm border-2 border-teal bg-teal/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal">−{u.discount_percent}%</span>}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink2">
                    {u.email} · рег. {fmtDate(u.registered_at)}
                    {u.tariff_id !== "free" && ` · до ${fmtDate(u.tariff_expires_at)}`}
                  </p>
                </div>
                <Icon name={selectedId === u.id ? "chevronDown" : "chevronDown"} size={14} />
              </button>
              {selectedId === u.id && <UserDetailPanel id={u.id} ownId={profile.id} onChanged={refresh} onClose={() => setSelectedId(null)} />}
            </div>
          ))
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-40">
            ← Назад
          </button>
          <span className="font-mono text-[12px] text-ink2">
            {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="btn btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-40">
            Вперёд →
          </button>
        </div>
      )}
    </div>
  );
}
