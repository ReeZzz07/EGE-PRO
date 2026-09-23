// Плашка приветственного оффера: скидка на первую оплату + живой таймер до конца. Показывается
// на дашборде, странице тарифов и в пейволлах (см. Dashboard.tsx, Tariffs.tsx, PaywallCard.tsx).
import { useEffect } from "react";
import { useCountdown } from "../lib/utils";
import { reachGoalOnce } from "../lib/metrika";
import type { WelcomeOffer } from "../lib/offers";
import { Icon } from "./ui";
import type { View } from "./Header";

const pad = (n: number) => String(n).padStart(2, "0");

export function OfferClock({ expiresAt }: { expiresAt: string }) {
  const t = useCountdown(new Date(expiresAt));
  return (
    <span className="font-mono font-bold tabular-nums">
      {t.days > 0 ? `${t.days} д ` : ""}
      {pad(t.hours)}:{pad(t.minutes)}:{pad(t.seconds)}
    </span>
  );
}

export default function WelcomeOfferBanner({ offer, onNav }: { offer: WelcomeOffer; onNav?: (v: View) => void }) {
  useEffect(() => {
    reachGoalOnce("offer_seen", "offer_seen", "forever", { percent: offer.percent });
  }, [offer.percent]);
  return (
    <div className="anim-rise mt-6 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-hl px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <Icon name="spark" size={20} className="mt-0.5 shrink-0" />
        <p className="text-[13.5px] leading-snug text-ink">
          <strong className="font-display text-[15px]">−{offer.percent}% на первую оплату тарифа.</strong>{" "}
          Скидка применится сама при оплате, до конца — <OfferClock expiresAt={offer.expiresAt} />
        </p>
      </div>
      {onNav && (
        <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink shrink-0 px-4 py-2 text-[12.5px]">
          Выбрать тариф <Icon name="arrowR" size={14} />
        </button>
      )}
    </div>
  );
}
