// /renew — продление платного тарифа «как было»: тот же тариф и те же докупленные предметы, одной
// оплатой, без повторного выбора тарифа и предметов. На эту страницу ведут письма о сроке тарифа и
// плашка на главной. Тариф и состав определяет сервер по профилю (POST /payments/renew без тела).
import { useEffect, useState } from "react";
import { SUBJECTS } from "../data/tasks";
import { useAuth } from "../lib/auth";
import { reachGoal } from "../lib/metrika";
import { startRenewalPayment } from "../lib/subscription";
import { Icon, useToast } from "./ui";
import { fmtDate } from "./SubscriptionBanner";
import type { View } from "./Header";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export default function RenewView({ onNav }: { onNav: (v: View) => void }) {
  const { profile, refreshProfile } = useAuth();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  // состояние подписки — свежее, а не из момента входа: сюда часто приходят по ссылке из письма
  useEffect(() => {
    refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sub = profile?.subscription;
  const r = sub?.renewal;

  const pay = async () => {
    if (!r) return;
    setBusy(true);
    const res = await startRenewalPayment();
    setBusy(false);
    if (res.error) return push(res.error, "err");
    if (res.confirmationUrl) {
      const url = res.confirmationUrl;
      reachGoal("checkout_start", { tariff: r.tariffId, price: r.amountRub, kind: "renewal" }, () => {
        window.location.href = url;
      });
    }
  };

  if (!sub || !r) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-xl font-black">Нечего продлять</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">У тебя нет платного тарифа, который можно продлить. Выбери подходящий — это займёт минуту.</p>
        <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue mt-6 px-5 py-2.5 text-sm">
          Смотреть тарифы <Icon name="arrowR" size={16} />
        </button>
      </div>
    );
  }

  const frozen = sub.frozenSubjects;
  const discountRub = Math.round((r.tariffPriceRub + r.addonsPriceRub - r.amountRub) * 100) / 100;
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">продление</p>
      <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Продлить тариф «{r.tariffName}»</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
        {sub.expired ? (
          <>Срок закончился {sub.expiresAt ? fmtDate(sub.expiresAt) : ""}. Все твои данные и прогресс на месте — продление вернёт тариф и доступ к предметам без повторного выбора.</>
        ) : (
          <>Тариф действует до {sub.expiresAt ? fmtDate(sub.expiresAt) : "…"}. Новые 30 дней прибавятся к оставшимся — ничего не потеряется.</>
        )}
      </p>

      <div className="sheet mt-6 p-5 sm:p-6">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-ink2">что продлеваем — те же настройки</p>
        <dl className="mt-3 space-y-2 text-[14px]">
          <div className="flex justify-between gap-4">
            <dt>Тариф «{r.tariffName}» на {r.periodDays} дней</dt>
            <dd className="font-mono font-bold tabular-nums">{rub(r.tariffPriceRub)}</dd>
          </div>
          {r.extraSubjects > 0 && (
            <div className="flex justify-between gap-4">
              <dt>Докупленные предметы: {r.extraSubjects}</dt>
              <dd className="font-mono font-bold tabular-nums">{rub(r.addonsPriceRub)}</dd>
            </div>
          )}
          {r.discountPercent ? (
            <div className="flex justify-between gap-4 text-teal">
              <dt>Твоя скидка −{r.discountPercent}%</dt>
              <dd className="font-mono font-bold tabular-nums">−{rub(discountRub)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t-2 border-dashed border-ink/25 pt-3 text-[16px]">
            <dt className="font-bold">К оплате</dt>
            <dd className="font-display text-xl font-black tabular-nums">{rub(r.amountRub)}</dd>
          </div>
        </dl>

        {frozen.length > 0 && (
          <p className="mt-4 border-l-4 border-teal bg-teal/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink/85">
            После оплаты снова откроется доступ к предметам: <strong>{frozen.map((s) => SUBJECTS[s]?.name ?? s).join(", ")}</strong>.
          </p>
        )}

        <button onClick={pay} disabled={busy} className="btn btn-blue mt-5 w-full justify-center px-5 py-3 text-sm">
          {busy ? "Открываем оплату…" : `Продлить и оплатить ${rub(r.amountRub)}`}
          {!busy && <Icon name="arrowR" size={16} />}
        </button>
        <p className="mt-3 text-center text-[12px] text-ink2">Оплата разовая на {r.periodDays} дней через ЮKassa — без автосписаний, карту мы не сохраняем.</p>
      </div>

      <button onClick={() => onNav({ name: "tariffs" })} className="link-slide mt-6 block text-[12.5px] font-bold text-ink2 hover:text-ink">
        Выбрать другой тариф
      </button>
    </div>
  );
}
