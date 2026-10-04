// Журнал обращений (docker/api/feedback.js → /admin/feedback): список с фильтрами и сортировкой, карточка
// обращения с полной историей событий (создано, письма, смена статуса, заметки, ответы) и ответом автору
// прямо из админки. Вторая вкладка — контакты и каналы связи для страницы /contacts (почта, WhatsApp,
// Telegram, VK). Ничего не удаляется: закрытое обращение остаётся в журнале.
import { useCallback, useEffect, useState } from "react";
import {
  FEEDBACK_TOPICS, STATUS_LABEL, STATUS_ORDER, TOPIC_LABEL,
  loadAdminFeedback, loadAdminFeedbackDetail, loadContactSettings, replyAdminFeedback, saveContactSettings, updateAdminFeedback,
  type AdminFeedbackDetail, type AdminFeedbackItem, type AdminFeedbackList, type ChannelId, type ChannelMeta, type ContactSettings, type FeedbackEventType, type FeedbackFilters, type FeedbackStatus,
} from "../lib/feedback";
import { useToast } from "./ui";

const dateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: "border-red text-red",
  in_progress: "border-amber text-amber",
  answered: "border-blue text-blue",
  closed: "border-ink/30 text-ink2",
};

const EVENT_LABEL: Record<FeedbackEventType, string> = {
  created: "Обращение создано",
  team_notified: "Письмо команде отправлено",
  team_notify_failed: "Письмо команде НЕ отправилось",
  ack_sent: "Подтверждение автору отправлено",
  ack_failed: "Подтверждение автору НЕ отправилось",
  status_changed: "Статус изменён",
  note_changed: "Заметка изменена",
  reply_sent: "Ответ отправлен автору",
  reply_failed: "Ответ НЕ отправился",
};

const SORT_OPTIONS: { id: NonNullable<FeedbackFilters["sort"]>; label: string }[] = [
  { id: "created", label: "По дате создания" },
  { id: "updated", label: "По последнему изменению" },
  { id: "status", label: "По статусу" },
  { id: "topic", label: "По теме" },
  { id: "id", label: "По номеру" },
];

function StatusBadge({ status }: { status: FeedbackStatus }) {
  return <span className={`rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function Delivery({ item }: { item: Pick<AdminFeedbackItem, "teamNotified" | "ackSent"> }) {
  const mark = (v: string) => (v === "ok" ? "✓" : v === "failed" ? "✗" : "…");
  const bad = item.teamNotified === "failed" || item.ackSent === "failed";
  return (
    <span className={`font-mono text-[11px] ${bad ? "font-bold text-red" : "text-ink2"}`} title="Письмо команде / подтверждение автору">
      ✉ {mark(item.teamNotified)} {mark(item.ackSent)}
    </span>
  );
}

function Detail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { push } = useToast();
  const [d, setD] = useState<AdminFeedbackDetail | null>(null);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (detail: AdminFeedbackDetail) => {
    setD(detail);
    setNote(detail.adminNote ?? "");
    onChanged();
  };

  useEffect(() => {
    loadAdminFeedbackDetail(id).then((x) => {
      if (x) {
        setD(x);
        setNote(x.adminNote ?? "");
      }
    });
  }, [id]);

  if (!d) return <p className="p-4 font-mono text-[12px] text-ink2">Загрузка…</p>;

  const changeStatus = async (status: FeedbackStatus) => {
    setBusy(true);
    const r = await updateAdminFeedback(id, { status });
    setBusy(false);
    if (r.error) return push(r.error, "err");
    apply(r.detail!);
  };
  const saveNote = async () => {
    setBusy(true);
    const r = await updateAdminFeedback(id, { note });
    setBusy(false);
    if (r.error) return push(r.error, "err");
    push("Заметка сохранена", "ok");
    apply(r.detail!);
  };
  const sendReply = async () => {
    setBusy(true);
    const r = await replyAdminFeedback(id, reply);
    setBusy(false);
    if (r.error) {
      push(r.error, "err");
      const fresh = await loadAdminFeedbackDetail(id); // сбой тоже записан в журнал — показываем
      if (fresh) setD(fresh);
      return;
    }
    push("Ответ отправлен автору", "ok");
    setReply("");
    apply(r.detail!);
  };

  return (
    <div className="grid gap-5 border-t-2 border-dashed border-ink/20 bg-ink/[0.03] p-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <p className="whitespace-pre-wrap border-l-4 border-blue bg-paper px-3 py-2.5 text-[14px] leading-relaxed">{d.message}</p>

        <dl className="grid gap-x-4 gap-y-1 font-mono text-[11.5px] text-ink2 sm:grid-cols-2">
          <div>Почта: <b className="text-ink">{d.email}</b></div>
          <div>Имя: <b className="text-ink">{d.name || "—"}</b></div>
          <div>Аккаунт: <b className="text-ink">{d.userId ? "есть" : "гость"}</b>{d.context.tariff ? ` · тариф ${d.context.tariff}` : ""}</div>
          <div>Страница: <b className="text-ink">{d.source || "—"}</b></div>
          {d.taskId && <div>Задание: <b className="text-ink">{d.taskId}</b></div>}
          {d.context.userAgent && <div className="sm:col-span-2 break-all">Браузер: {d.context.userAgent}</div>}
          {(d.teamNotifyError || d.ackError) && <div className="sm:col-span-2 text-red">Ошибки отправки: {d.teamNotifyError ?? d.ackError}</div>}
        </dl>

        <div>
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Ответить автору (письмо с адреса сервиса)</p>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={5000} placeholder="Текст ответа" className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13.5px]" />
          <button onClick={sendReply} disabled={busy || reply.trim().length < 2} className="btn btn-ink mt-2 px-4 py-2 text-[12.5px] disabled:opacity-40">
            Отправить ответ
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Статус</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => changeStatus(s)}
                disabled={busy || d.status === s}
                className={`rounded-sm border-2 px-2.5 py-1 text-[12px] font-bold transition ${d.status === s ? "border-blue bg-blue text-white" : "border-ink/20 text-ink2 hover:text-ink"}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Внутренняя заметка (автор её не видит)</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]" />
          <button onClick={saveNote} disabled={busy || note.trim() === (d.adminNote ?? "")} className="btn btn-ghost mt-2 px-3.5 py-1.5 text-[12px] disabled:opacity-40">
            Сохранить заметку
          </button>
        </div>

        <div>
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">История</p>
          <ol className="mt-1.5 space-y-2 border-l-2 border-ink/15 pl-3">
            {d.events.map((e) => {
              const bad = e.type.endsWith("failed");
              return (
                <li key={e.id} className="text-[12.5px]">
                  <span className="font-mono text-[10.5px] text-ink2">{dateTime(e.createdAt)}</span>
                  <p className={bad ? "font-bold text-red" : "font-bold"}>
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.type === "status_changed" && `: ${STATUS_LABEL[e.data.from as FeedbackStatus] ?? e.data.from} → ${STATUS_LABEL[e.data.to as FeedbackStatus] ?? e.data.to}`}
                  </p>
                  {e.actor && <p className="font-mono text-[11px] text-ink2">{e.actor}</p>}
                  {(e.type === "reply_sent" || e.type === "reply_failed" || e.type === "note_changed") && e.data.text && <p className="mt-0.5 whitespace-pre-wrap text-ink2">{e.data.text}</p>}
                  {bad && e.data.error && <p className="font-mono text-[11px] text-red">{e.data.error}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Journal() {
  const [filters, setFilters] = useState<FeedbackFilters>({ status: "", topic: "", q: "", from: "", to: "", overdue: false, delivery: "", sort: "created", dir: "desc", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminFeedbackList | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setData(await loadAdminFeedback(filters));
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  // поиск запускаем с небольшой задержкой, а не на каждую букву
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]);

  const set = (patch: Partial<FeedbackFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = () => {
    setSearch("");
    setFilters({ status: "", topic: "", q: "", from: "", to: "", overdue: false, delivery: "", sort: "created", dir: "desc", page: 1 });
  };

  return (
    <div>
      {data && (
        <div className="flex flex-wrap gap-2" aria-label="Сводка по статусам">
          <button onClick={() => set({ status: "" })} className="rounded-sm border-2 border-ink/20 px-3 py-1.5 text-[12.5px] font-bold hover:border-ink">
            Все <span className="ml-1 font-mono text-[11px] opacity-80">{STATUS_ORDER.reduce((a, s) => a + data.counts[s], 0)}</span>
          </button>
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => set({ status: s })} className={`rounded-sm border-2 px-3 py-1.5 text-[12.5px] font-bold ${filters.status === s ? "border-blue bg-blue text-white" : "border-ink/20 hover:border-ink"}`}>
              {STATUS_LABEL[s]} <span className="ml-1 font-mono text-[11px] opacity-80">{data.counts[s]}</span>
            </button>
          ))}
          <button onClick={() => set({ overdue: !filters.overdue })} className={`rounded-sm border-2 px-3 py-1.5 text-[12.5px] font-bold ${filters.overdue ? "border-red bg-red text-white" : data.overdue > 0 ? "border-red text-red" : "border-ink/20"}`}>
            Просрочено <span className="ml-1 font-mono text-[11px]">{data.overdue}</span>
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Поиск (почта, имя, текст, №)</span>
          <input id="fb-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="например #12 или anya@mail.ru" className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Статус</span>
          <select id="fb-status" value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value as FeedbackFilters["status"] })} className="input-blank mt-1.5 w-full rounded-sm px-2.5 py-2 text-[13px]">
            <option value="">Все</option>
            <option value="open">Открытые (новые + в работе)</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тема</span>
          <select id="fb-topic" value={filters.topic ?? ""} onChange={(e) => set({ topic: e.target.value as FeedbackFilters["topic"] })} className="input-blank mt-1.5 w-full rounded-sm px-2.5 py-2 text-[13px]">
            <option value="">Все</option>
            {FEEDBACK_TOPICS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Создано с</span>
          <input id="fb-from" type="date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value })} className="input-blank mt-1.5 w-full rounded-sm px-2.5 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">по</span>
          <input id="fb-to" type="date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value })} className="input-blank mt-1.5 w-full rounded-sm px-2.5 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Сортировка</span>
          <select id="fb-sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as FeedbackFilters["sort"], page: 1 })} className="input-blank mt-1.5 w-full rounded-sm px-2.5 py-2 text-[13px]">
            {SORT_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button onClick={() => set({ dir: filters.dir === "desc" ? "asc" : "desc" })}className="btn btn-ghost px-3 py-2 text-[12.5px]">
            {filters.dir === "desc" ? "Сначала новые ↓" : "Сначала старые ↑"}
          </button>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-bold">
          <input id="fb-delivery" type="checkbox" checked={filters.delivery === "failed"} onChange={(e) => set({ delivery: e.target.checked ? "failed" : "" })} className="h-4 w-4 accent-blue" />
          Письмо не ушло
        </label>
        <div className="flex items-center">
          <button onClick={reset} className="link-slide text-[12.5px] font-bold text-ink2 hover:text-ink">
            Сбросить фильтры
          </button>
        </div>
      </div>

      {loading && !data ? (
        <p className="mt-6 font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      ) : !data ? (
        <p className="mt-6 text-[13px] text-red">Не удалось загрузить обращения.</p>
      ) : data.items.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink2">По этим условиям обращений нет.</p>
      ) : (
        <>
          <p className="mt-5 font-mono text-[11.5px] text-ink2">
            Найдено: {data.total} · страница {data.page} из {pages}
          </p>
          <ul className="mt-2 space-y-2">
            {data.items.map((it) => (
              <li key={it.id} className="border-2 border-ink/15">
                <button onClick={() => setOpenId(openId === it.id ? null : it.id)} aria-expanded={openId === it.id} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left hover:bg-ink/5">
                  <span className="font-mono text-[12px] font-bold">№{it.id}</span>
                  <StatusBadge status={it.status} />
                  {it.overdue && <span className="rounded-sm bg-red px-1.5 py-0.5 font-mono text-[10.5px] font-bold uppercase text-white">просрочено</span>}
                  <span className="text-[13px] font-bold">{TOPIC_LABEL[it.topic] ?? it.topic}</span>
                  <span className="text-[12.5px] text-ink2">{it.name || it.email}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <Delivery item={it} />
                    <span className="font-mono text-[11px] text-ink2">{dateTime(it.createdAt)}</span>
                  </span>
                  <span className="w-full truncate text-[12.5px] text-ink2">{it.message}</span>
                </button>
                {openId === it.id && <Detail id={it.id} onChanged={reload} />}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => set({ page: (filters.page ?? 1) - 1 })} disabled={(filters.page ?? 1) <= 1} className="btn btn-ghost px-3.5 py-2 text-[12.5px] disabled:opacity-40">
              ← Назад
            </button>
            <button onClick={() => set({ page: (filters.page ?? 1) + 1 })} disabled={(filters.page ?? 1) >= pages} className="btn btn-ghost px-3.5 py-2 text-[12.5px] disabled:opacity-40">
              Вперёд →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const CHANNEL_HINT: Record<ChannelId, string> = {
  whatsapp: "Ссылка WhatsApp Business вида https://wa.me/message/… — она не показывает номер телефона.",
  telegram: "Например https://t.me/имя_канала_или_бота.",
  vk: "Например https://vk.com/имя_сообщества или https://vk.me/….",
};

function ChannelsSettings() {
  const { push } = useToast();
  const [s, setS] = useState<ContactSettings | null>(null);
  const [meta, setMeta] = useState<ChannelMeta[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadContactSettings().then((r) => {
      if (r) {
        setS(r.settings);
        setMeta(r.channels);
      }
    });
  }, []);

  if (!s) return <p className="font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;

  const save = async () => {
    setBusy(true);
    const r = await saveContactSettings(s);
    setBusy(false);
    if (r.error) return push(r.error, "err");
    setS(r.settings!);
    push("Контакты сохранены", "ok");
  };

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-[13px] leading-relaxed text-ink2">
        Эти контакты показываются на странице «Контакты». На адрес поддержки приходят все новые обращения (с Reply-To автора), он же стоит в Reply-To наших ответов. Мессенджер появляется на странице, когда включён и указана ссылка. Номер телефона не публикуем.
      </p>
      <label className="block">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Почта поддержки</span>
        <input id="ct-email" type="email" value={s.supportEmail} onChange={(e) => setS({ ...s, supportEmail: e.target.value })} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]" />
      </label>
      {meta.map((m) => (
        <div key={m.id} className="border-2 border-ink/15 p-4">
          <label className="flex items-center gap-2.5 text-[13.5px] font-bold">
            <input
              id={`ct-${m.id}-on`}
              type="checkbox"
              checked={s.channels[m.id].enabled}
              onChange={(e) => setS({ ...s, channels: { ...s.channels, [m.id]: { ...s.channels[m.id], enabled: e.target.checked } } })}
              className="h-4 w-4 accent-blue"
            />
            {m.label}
          </label>
          <input
            id={`ct-${m.id}-url`}
            aria-label={`Ссылка ${m.label}`}
            value={s.channels[m.id].url}
            onChange={(e) => setS({ ...s, channels: { ...s.channels, [m.id]: { ...s.channels[m.id], url: e.target.value } } })}
            placeholder="https://…"
            className="input-blank mt-2 w-full rounded-sm px-3 py-2 font-mono text-[12.5px]"
          />
          <p className="mt-1 text-[11.5px] text-ink2">{CHANNEL_HINT[m.id]} Разрешённые домены: {m.hosts.join(", ")}.</p>
        </div>
      ))}
      <button onClick={save} disabled={busy} className="btn btn-ink px-5 py-2.5 text-[13px]">
        {busy ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}

export default function AdminFeedback() {
  const [tab, setTab] = useState<"journal" | "channels">("journal");
  return (
    <div>
      <div className="flex gap-1 border-b-2 border-ink/10" role="tablist">
        {([["journal", "Обращения"], ["channels", "Контакты и каналы"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-4 py-2 text-[13px] font-bold ${tab === id ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">{tab === "journal" ? <Journal /> : <ChannelsSettings />}</div>
    </div>
  );
}
