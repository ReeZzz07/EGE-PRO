import { useEffect, useState } from "react";
import { clearAllClientErrors, loadClientErrors, type ClientErrorItem } from "../lib/clientErrors";
import { Icon, useToast } from "./ui";

export default function AdminClientErrors() {
  const { push } = useToast();
  const [items, setItems] = useState<ClientErrorItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const reload = () => {
    setLoading(true);
    loadClientErrors()
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => push(e instanceof Error ? e.message : "Ошибка загрузки", "err"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = async () => {
    if (!confirm("Очистить весь журнал ошибок?")) return;
    try {
      await clearAllClientErrors();
      setItems([]);
      setTotal(0);
      push("Журнал очищен", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Не удалось очистить", "err");
    }
  };

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Журнал клиентских ошибок</h2>
          <p className="mt-1 text-[12.5px] text-ink2">ErrorBoundary, window.onerror и unhandledrejection. Всего: {total}.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reload} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
            <Icon name="refresh" size={14} /> Обновить
          </button>
          <button onClick={clear} className="btn btn-ghost px-3.5 py-2 text-[12.5px] text-red">
            Очистить
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-center font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-[13.5px] text-ink2">Пока пусто — это хорошо.</p>
      ) : (
        <ul className="mt-5 divide-y divide-ink/10">
          {items.map((it) => (
            <li key={it.id} className="py-3">
              <button type="button" className="w-full text-left" onClick={() => setOpenId(openId === it.id ? null : it.id)}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink2">
                    {it.source} · {new Date(it.createdAt).toLocaleString("ru-RU")}
                  </span>
                  <span className="text-[12px] text-ink2">{it.userEmail ?? it.userName ?? "гость"}</span>
                </div>
                <p className="mt-1 text-[13.5px] font-semibold">{it.message}</p>
                {it.url && <p className="mt-0.5 font-mono text-[11px] text-ink2 truncate">{it.url}</p>}
              </button>
              {openId === it.id && it.stack && (
                <pre className="mt-2 max-h-48 overflow-auto border-2 border-ink/10 bg-paper/80 p-2 text-[11px] leading-relaxed">{it.stack}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
