// Приглашение оставить отзыв — показывается только тем, кто выполнил все условия (онбординг,
// диагностика, 5 обращений к репетитору) и ещё не писал отзыв. Карточка — на дашборде, полоска — в чате
// репетитора. Закрытие запоминается в браузере (на следующем устройстве приглашение покажется снова —
// это не страшно, а постоянное место для отзыва есть в профиле).
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useMyReviewState } from "../lib/reviews";
import { Icon } from "./ui";

function dismissKey(variant: string, userId: string) {
  return `review-prompt-${variant}:${userId}`;
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** card — светлая карточка на дашборде; strip — тёмная полоска в чате репетитора (TutorChat.tsx). */
export default function ReviewPrompt({ variant, onOpen }: { variant: "card" | "strip"; onOpen: () => void }) {
  const { profile } = useAuth();
  const { state } = useMyReviewState();
  const key = profile ? dismissKey(variant, profile.id) : "";
  const [dismissed, setDismissed] = useState(() => (key ? readDismissed(key) : false));

  if (!profile || dismissed || !state || !state.eligibility.eligible || state.review) return null;

  const close = () => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* без localStorage закрываем только до перезагрузки */
    }
    setDismissed(true);
  };

  if (variant === "strip") {
    return (
      <div className="anim-rise flex flex-wrap items-center justify-between gap-2 rounded-md border border-hl/40 bg-hl/10 px-3.5 py-2.5 text-paper">
        <p className="text-[12.5px] text-paper/80">
          <strong className="text-hl">Репетитор помог?</strong> Расскажи другим ученикам — это минута.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onOpen} className="rounded-sm bg-hl px-3 py-1.5 text-[12px] font-bold text-night transition hover:brightness-110">
            Оставить отзыв
          </button>
          <button onClick={close} aria-label="Скрыть" className="rounded-sm border border-white/20 px-2 py-1.5 text-paper/70 transition hover:bg-white/10">
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-rise mt-6 flex flex-wrap items-center justify-between gap-3 border-l-4 border-blue bg-blue/5 px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <Icon name="star" size={18} className="mt-0.5 shrink-0 text-blue" />
        <p className="text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Ты уже позанимался в ЕГЭ·ПРО — расскажи, как идёт.</strong> Честный отзыв поможет нам стать лучше, а другим ученикам — выбрать, где готовиться.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button onClick={onOpen} className="btn btn-ink px-3.5 py-2 text-[12.5px]">
          Оставить отзыв
        </button>
        <button onClick={close} aria-label="Скрыть" className="btn btn-ghost px-2.5 py-2 text-[12.5px]">
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}
