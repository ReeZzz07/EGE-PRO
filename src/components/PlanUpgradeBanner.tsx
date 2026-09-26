// Постоянная плашка на главном экране для тех, кто уже увидел свой план (прошёл диагностику), но остался
// на бесплатном тарифе. Раньше единственное, что напоминало им про оплату на дашборде, — плашка скидки, и
// та исчезала вместе с таймером (разбор воронки 26.09.2026: 11 человек дошли до плана, никто не заплатил, а
// после истечения скидки на главном экране про тарифы не было ни слова). Плашку можно свернуть кнопкой —
// на время текущей сессии (вкладки/визита): sessionStorage переживает переходы по приложению и перезагрузку,
// но в следующей сессии плашка снова на месте; насовсем она пропадает только с оплатой. Если скидка ещё жива,
// её таймер показан прямо здесь (отдельная плашка скидки на дашборде тогда не нужна — см. Dashboard.tsx).
import { useState } from "react";
import type { WelcomeOffer } from "../lib/offers";
import { Icon } from "./ui";
import { OfferClock } from "./WelcomeOfferBanner";
import type { View } from "./Header";

export const PLAN_UPGRADE_DISMISSED_KEY = "ege-pro.plan-upgrade-dismissed.v1";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(PLAN_UPGRADE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function PlanUpgradeBanner({
  subjectName,
  weakTopics,
  offer,
  onNav,
}: {
  subjectName: string;
  weakTopics: string[];
  offer: WelcomeOffer | null;
  onNav: (v: View) => void;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  const topics = weakTopics.slice(0, 3);
  const dismiss = () => {
    try {
      sessionStorage.setItem(PLAN_UPGRADE_DISMISSED_KEY, "1");
    } catch {
      /* без sessionStorage свернётся только до перемонтирования — не критично */
    }
    setDismissed(true);
  };
  return (
    <div data-testid="plan-upgrade-banner" className="anim-rise mt-6 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-hl px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <Icon name="spark" size={20} className="mt-0.5 shrink-0" />
        <div className="text-[13.5px] leading-snug text-ink">
          <strong className="font-display text-[15px]">Твой план по предмету «{subjectName}» готов.</strong>{" "}
          {topics.length > 0 ? (
            <>
              Слабые темы: {topics.join(", ")}. На бесплатном тарифе ИИ-репетитор отвечает 3 раза в день — разбирать их по шагам удобнее без лимита.
            </>
          ) : (
            <>На бесплатном тарифе ИИ-репетитор отвечает 3 раза в день — без лимита подсказки по уровням и разбор ошибок по шагам.</>
          )}
          {offer && (
            <span data-testid="plan-upgrade-offer" className="mt-1.5 block font-bold">
              −{offer.percent}% на первую оплату · осталось <OfferClock expiresAt={offer.expiresAt} />
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink px-4 py-2 text-[12.5px]">
          Смотреть тарифы <Icon name="arrowR" size={14} />
        </button>
        <button onClick={() => onNav({ name: "plan" })} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          Открыть план
        </button>
        <button onClick={dismiss} aria-label="Свернуть до следующего визита" className="btn btn-ghost px-2.5 py-2 text-[12.5px]">
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}
