// Плашка приветственного оффера: скидка на первую оплату + живой таймер до конца. Показывается
// на дашборде, странице тарифов и в пейволлах (см. Dashboard.tsx, Tariffs.tsx, PaywallCard.tsx).
import { useEffect } from "react";
import { useCountdown } from "../lib/utils";
import { reachGoalOnce } from "../lib/metrika";
import { useWelcomeOffer, type WelcomeOffer } from "../lib/offers";
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

const STEP_NAME: Record<string, string> = { onboarding: "онбординг", diagnostic: "диагностику" };

/** Что осталось пройти, чтобы скидка выросла: «онбординг (+10%) и диагностику (+10%)». */
export function pendingStepsText(offer: WelcomeOffer): string {
  return offer.steps
    .filter((s) => !s.earned && s.percent > 0 && STEP_NAME[s.key])
    .map((s) => `${STEP_NAME[s.key]} (+${s.percent}%)`)
    .join(" и ");
}

const STEP_LABEL: Record<string, string> = { confirm: "Подтверждение почты", onboarding: "Онбординг", diagnostic: "Диагностика" };
const STEP_VIEW: Record<string, View> = { onboarding: { name: "onboarding" }, diagnostic: { name: "diagnostic" } };

/** onTariffsPage — плашка уже на странице тарифов: кнопка «Выбрать тариф» там не нужна. */
export default function WelcomeOfferBanner({ offer, onNav, onTariffsPage = false }: { offer: WelcomeOffer; onNav?: (v: View) => void; onTariffsPage?: boolean }) {
  useEffect(() => {
    reachGoalOnce("offer_seen", "offer_seen", "forever", { percent: offer.percent });
  }, [offer.percent]);
  const pending = pendingStepsText(offer);
  const grows = !!pending && offer.maxPercent > offer.percent;
  const steps = offer.steps.filter((s) => s.percent > 0 && STEP_LABEL[s.key]);
  return (
    <div className="anim-rise mt-6 border-2 border-ink bg-hl px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon name="spark" size={20} className="mt-0.5 shrink-0" />
          <p className="text-[13.5px] leading-snug text-ink">
            <strong className="font-display text-[15px]">−{offer.percent}% на первую оплату тарифа.</strong>{" "}
            {grows && (
              <>
                Пройди {pending} — и скидка вырастет до <strong>−{offer.maxPercent}%</strong>.{" "}
              </>
            )}
            Применится сама при оплате, до конца — <OfferClock expiresAt={offer.expiresAt} />
          </p>
        </div>
        {onNav && !onTariffsPage && (
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink shrink-0 px-4 py-2 text-[12.5px]">
            Выбрать тариф <Icon name="arrowR" size={14} />
          </button>
        )}
      </div>
      {grows && steps.length > 1 && (
        <ul data-testid="offer-steps" className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
          {steps.map((s) =>
            s.earned ? (
              <li key={s.key} className="inline-flex items-center gap-1.5 border-2 border-ink/40 bg-paper/60 px-2.5 py-1.5 text-ink/70">
                <Icon name="check" size={13} /> {STEP_LABEL[s.key]} <strong>−{s.percent}%</strong>
              </li>
            ) : (
              <li key={s.key}>
                {onNav && STEP_VIEW[s.key] ? (
                  <button onClick={() => onNav(STEP_VIEW[s.key])} className="inline-flex items-center gap-1.5 border-2 border-ink bg-paper px-2.5 py-1.5 font-bold text-ink transition hover:bg-ink hover:text-paper">
                    {STEP_LABEL[s.key]} <strong>+{s.percent}%</strong> <Icon name="arrowR" size={13} />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 border-2 border-ink bg-paper px-2.5 py-1.5 font-bold text-ink">
                    {STEP_LABEL[s.key]} <strong>+{s.percent}%</strong>
                  </span>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

/** Компактная полоса на экранах онбординга и диагностики: что даёт ИМЕННО этот шаг. Показывается только
 *  тому, у кого есть живой оффер и этот шаг ещё не засчитан — иначе молчит. */
export function OfferStepHint({ step }: { step: "onboarding" | "diagnostic" }) {
  const offer = useWelcomeOffer();
  const cur = offer?.steps.find((s) => s.key === step);
  if (!offer || !cur || cur.earned || cur.percent <= 0) return null;
  const diagnosticLeft = step === "onboarding" ? offer.steps.find((s) => s.key === "diagnostic" && !s.earned && s.percent > 0) : undefined;
  return (
    <div data-testid="offer-step-hint" className="anim-rise mb-6 flex items-start gap-2.5 border-2 border-ink bg-hl px-3.5 py-2.5 text-[12.5px] leading-snug text-ink">
      <Icon name="spark" size={16} className="mt-0.5 shrink-0" />
      <p>
        {step === "onboarding" ? (
          <>
            <strong>Почта подтверждена — уже −{offer.percent}% на первую оплату.</strong> Закончи онбординг — ещё −{cur.percent}%
            {diagnosticLeft ? <>, а за диагностику — ещё −{diagnosticLeft.percent}%</> : null}: итого до <strong>−{offer.maxPercent}%</strong>.
          </>
        ) : (
          <>
            <strong>Диагностика добавит к скидке ещё −{cur.percent}%</strong> — итого до <strong>−{offer.maxPercent}%</strong> на первую оплату тарифа.
          </>
        )}{" "}
        Осталось <OfferClock expiresAt={offer.expiresAt} />
      </p>
    </div>
  );
}
