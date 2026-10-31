import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { Icon, useToast } from "./ui";

interface Item {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  optional?: boolean;
}

export default function AdminLaunchReadiness() {
  const { push } = useToast();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    apiFetch("/admin/launch-readiness")
      .then(async (resp) => {
        if (!resp.ok) throw new Error("Не удалось загрузить чеклист");
        return resp.json();
      })
      .then((json) => {
        setReady(!!json.ready);
        setItems(json.items ?? []);
      })
      .catch((e) => push(e instanceof Error ? e.message : "Ошибка", "err"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Готовность к запуску</h2>
          <p className="mt-1 text-[12.5px] text-ink2">
            Проверка секретов и контента перед платным трафиком. Секреты не показываются — только «есть / нет».
          </p>
        </div>
        <button onClick={reload} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          <Icon name="refresh" size={14} /> Обновить
        </button>
      </div>

      {loading ? (
        <p className="mt-8 text-center font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Проверяем…</p>
      ) : (
        <>
          <p
            className={`mt-5 border-l-4 px-4 py-3 text-[13.5px] font-bold ${
              ready ? "border-blue bg-blue/10 text-ink" : "border-amber bg-amber/10 text-ink"
            }`}
          >
            {ready
              ? "Обязательные пункты закрыты — можно деплоить и принимать оплату (после ручной проверки банка и jailbreak ИИ)."
              : "Есть незакрытые обязательные пункты — платный трафик лить рано."}
          </p>
          <ul className="mt-5 space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 border-2 border-ink/10 px-3 py-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border-2 ${it.ok ? "border-ink bg-hl" : "border-red bg-red/10 text-red"}`}>
                  <Icon name={it.ok ? "check" : "alert"} size={14} />
                </span>
                <div>
                  <p className="font-bold">
                    {it.title}
                    {it.optional ? <span className="ml-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink2">опц.</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink2">{it.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
