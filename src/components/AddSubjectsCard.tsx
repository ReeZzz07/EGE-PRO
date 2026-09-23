// Докупка предметов к действующему платному тарифу: срок тарифа не меняется, цена — пропорционально
// оставшимся дням (считает сервер, см. docker/api/subscription.js → addon). Докупленные предметы
// входят в продление «как было» (см. RenewView.tsx).
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { reachGoal } from "../lib/metrika";
import { daysLabel, startAddonPayment } from "../lib/subscription";
import { Icon, useToast } from "./ui";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export default function AddSubjectsCard() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const sub = profile?.subscription;
  const addon = sub?.addon;
  if (!sub || !addon) return null;

  const n = Math.min(count, addon.maxCount);
  const price = addon.quotes[n - 1];
  const perMonth = addon.unitPriceRub * n;

  const pay = async () => {
    setBusy(true);
    const res = await startAddonPayment(n);
    setBusy(false);
    if (res.error) return push(res.error, "err");
    if (res.confirmationUrl) {
      const url = res.confirmationUrl;
      reachGoal("checkout_start", { tariff: sub.tariffId, price, kind: "addon" }, () => {
        window.location.href = url;
      });
    }
  };

  return (
    <section className="mt-6 border-2 border-blue/40 bg-blue/5 p-4 sm:p-5">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">докупить предметы</p>
      <h2 className="font-display mt-1.5 text-lg font-black leading-snug">Нужен ещё предмет? Не обязательно менять тариф</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
        Добавь предметы к текущему тарифу «{sub.tariffName}». Платишь только за оставшийся срок — {daysLabel(addon.remainingDays)}. Дальше докупленные предметы входят в продление тарифа (
        {rub(addon.unitPriceRub)}/мес за каждый).
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Сколько предметов докупить">
          {Array.from({ length: addon.maxCount }, (_, i) => i + 1).map((k) => (
            <button
              key={k}
              onClick={() => setCount(k)}
              aria-pressed={n === k}
              className={`h-10 w-10 border-2 text-[14px] font-bold transition ${n === k ? "border-blue bg-blue text-white" : "border-ink/20 bg-paper hover:border-ink/50"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <button onClick={pay} disabled={busy} className="btn btn-blue px-5 py-2.5 text-sm">
          {busy ? "Открываем оплату…" : `Докупить · ${rub(price)}`}
          {!busy && <Icon name="arrowR" size={16} />}
        </button>
      </div>
      <p className="mt-2 font-mono text-[11.5px] text-ink2">
        {n} предм. · с продления — {rub(perMonth)}/мес · оплата разовая, без автосписаний
      </p>
    </section>
  );
}
