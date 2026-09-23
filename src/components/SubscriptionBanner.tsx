// Плашка о сроке платного тарифа: закончился или скоро закончится — с кнопкой продления «как было»
// (тот же тариф и те же докупленные предметы, без повторного выбора; см. RenewView.tsx).
import { useState } from "react";
import { daysLabel, type Subscription } from "../lib/subscription";
import { Icon } from "./ui";
import type { View } from "./Header";

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

/** за сколько дней до конца начинаем напоминать в интерфейсе */
const REMIND_DAYS = 5;

export function needsSubscriptionAttention(sub: Subscription | null | undefined): boolean {
  if (!sub?.renewal || sub.isAdmin) return false;
  return sub.expired || (sub.active && sub.daysLeft != null && sub.daysLeft <= REMIND_DAYS);
}

export default function SubscriptionBanner({ sub, onNav }: { sub: Subscription; onNav: (v: View) => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !needsSubscriptionAttention(sub) || !sub.renewal) return null;
  const frozen = sub.frozenSubjects.length;
  return (
    <div className={`anim-rise mt-6 flex flex-wrap items-center justify-between gap-3 border-l-4 px-4 py-3.5 sm:px-5 ${sub.expired ? "border-red bg-red/8" : "border-amber bg-amber/10"}`}>
      <div className="flex items-start gap-3">
        <Icon name="alert" size={18} className={`mt-0.5 shrink-0 ${sub.expired ? "text-red" : "text-amber"}`} />
        <p className="text-[13px] leading-relaxed text-ink2">
          {sub.expired ? (
            <>
              <strong className="text-ink">Тариф «{sub.renewal.tariffName}» закончился {sub.expiresAt ? fmtDate(sub.expiresAt) : ""}.</strong> Твои данные и прогресс сохранены
              {frozen > 0 ? `, доступ к ${frozen} предм. приостановлен` : ""} — продли с теми же настройками, и всё вернётся.
            </>
          ) : (
            <>
              <strong className="text-ink">Тариф «{sub.renewal.tariffName}» заканчивается через {daysLabel(sub.daysLeft ?? 0)}.</strong> Продли заранее с теми же настройками — новые 30 дней прибавятся к остатку.
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button onClick={() => onNav({ name: "renew" })} className="btn btn-blue px-3.5 py-2 text-[12.5px]">
          Продлить · {sub.renewal.amountRub.toLocaleString("ru-RU")} ₽ <Icon name="arrowR" size={14} />
        </button>
        {!sub.expired && (
          <button onClick={() => setDismissed(true)} aria-label="Скрыть до следующего входа" className="btn btn-ghost px-2.5 py-2 text-[12.5px]">
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
