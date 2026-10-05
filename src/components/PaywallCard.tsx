// Единый блок «это на платном тарифе» — показывается в момент, когда человек уже увидел ценность
// (результат диагностики, пробная проверка сочинения, исчерпанный лимит ИИ). Если есть активный
// приветственный оффер (см. lib/offers.ts), в блоке видны скидка и таймер.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useWelcomeOffer } from "../lib/offers";
import { reachGoalOnce } from "../lib/metrika";
import { Icon } from "./ui";
import { OfferClock, pendingStepsText } from "./WelcomeOfferBanner";
import ParentPayModal from "./ParentPayModal";
import type { View } from "./Header";

export default function PaywallCard({
  eyebrow,
  title,
  text,
  cta = "Смотреть тарифы",
  onNav,
  className = "",
}: {
  eyebrow: string;
  title: string;
  text: string;
  cta?: string;
  onNav: (v: View) => void;
  className?: string;
}) {
  const offer = useWelcomeOffer();
  const { profile } = useAuth();
  const [parentModal, setParentModal] = useState(false);
  useEffect(() => {
    reachGoalOnce(`paywall_seen:${eyebrow}`, "paywall_seen", "forever", { place: eyebrow });
  }, [eyebrow]);
  return (
    <div className={`border-2 border-blue/40 bg-blue/5 p-4 sm:p-5 ${className}`}>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">{eyebrow}</p>
      <h3 className="font-display mt-1.5 text-lg font-black leading-snug">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{text}</p>
      {offer && (
        <p className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 border-2 border-ink bg-hl px-3 py-1.5 text-[12.5px] text-ink">
          <Icon name="spark" size={14} />
          <strong>−{offer.percent}% на первую оплату</strong>{offer.maxPercent > offer.percent && pendingStepsText(offer) ? ` (до −${offer.maxPercent}%: пройди ${pendingStepsText(offer)})` : ""} · осталось <OfferClock expiresAt={offer.expiresAt} />
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue px-5 py-2.5 text-sm">
          {cta} <Icon name="arrowR" size={16} />
        </button>
        {profile && !profile.isAdmin && (
          <button onClick={() => setParentModal(true)} className="link-slide text-[12.5px] font-bold text-ink2 hover:text-ink">
            Нет карты? Попросить родителя оплатить
          </button>
        )}
      </div>
      {parentModal && <ParentPayModal place={`paywall:${eyebrow}`} onClose={() => setParentModal(false)} />}
    </div>
  );
}
