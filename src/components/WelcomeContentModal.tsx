// Попап на главной с текстом приветственного письма — появляется один раз, при первом заходе на
// дашборд после подтверждения email (см. lib/auth.tsx → WELCOME_POPUP_FLAG_KEY, Dashboard.tsx).
// Тот же текст, что уходит в письме (см. docker/api/mailer.js → sendWelcomeEmail и renderBodyRich
// там же — здесь та же логика вступление/пронумерованные пункты/заключение, только на React и в
// цветах Tailwind вместо инлайновых hex), но БЕЗ шапки-логотипа и футера: это и так уже сама
// платформа, не письмо, повторять брендинг незачем — пользователь и так на ней.
import { Icon } from "./ui";
import type { WelcomeEmailSettings } from "../lib/welcomeEmailSettings";

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const TIP_ACCENTS: { border: string; badge: string }[] = [
  { border: "border-blue", badge: "bg-blue" },
  { border: "border-teal", badge: "bg-teal" },
  { border: "border-violet", badge: "bg-violet" },
  { border: "border-amber", badge: "bg-amber" },
  { border: "border-rose", badge: "bg-rose" },
];

function BodyRich({ text }: { text: string }) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length <= 2) {
    return (
      <>
        {paragraphs.map((p, i) => (
          <p key={i} className="mt-3 text-[13.5px] leading-relaxed text-ink2 first:mt-0">
            {p}
          </p>
        ))}
      </>
    );
  }
  const intro = paragraphs[0];
  const outro = paragraphs[paragraphs.length - 1];
  const items = paragraphs.slice(1, -1);
  return (
    <>
      <p className="text-[14px] leading-relaxed text-ink">{intro}</p>
      <div className="mt-4 space-y-3">
        {items.map((p, i) => {
          const accent = TIP_ACCENTS[i % TIP_ACCENTS.length];
          return (
            <div key={i} className={`flex gap-3 border-l-[3px] pl-3 ${accent.border}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 border-ink text-[12px] font-black text-white ${accent.badge}`}>
                {i + 1}
              </span>
              <p className="text-[13.5px] leading-relaxed text-ink2">{p}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-ink2">{outro}</p>
    </>
  );
}

export default function WelcomeContentModal({
  content,
  name,
  onboarded,
  onClose,
  onOpenSettings,
}: {
  content: WelcomeEmailSettings;
  name: string;
  /** false — ученик ещё не заполнил анкету подготовки, показываем блок-напоминание с кнопкой,
   *  ровно та же логика, что и в письме (см. sendWelcomeEmail(..., { onboarded }) в mailer.js). */
  onboarded: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const greeting = name.trim() ? `Привет, ${name.trim()}!` : "Привет!";
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="sheet max-h-[85vh] w-full max-w-lg overflow-y-auto border-2 border-ink p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-blue">почта подтверждена</p>
            <h2 className="font-display mt-1 text-xl font-black leading-tight">{greeting}</h2>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="btn btn-ghost shrink-0 px-2.5 py-1.5 text-[12px]">
            <Icon name="x" size={14} />
          </button>
        </div>

        {content.subject && <p className="mt-2 text-[13px] font-bold text-ink2">{content.subject}</p>}

        <div className="mt-4">
          <BodyRich text={content.bodyText} />
        </div>

        {!onboarded && (
          <div className="anim-rise mt-4 border-l-4 border-amber bg-amber/10 px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-ink">{content.onboardingReminderText}</p>
            <button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="btn btn-ink mt-3 px-4 py-2 text-[12.5px]"
            >
              Заполнить анкету
            </button>
          </div>
        )}

        <button onClick={onClose} className="btn btn-blue mt-5 w-full px-5 py-2.5 text-sm">
          Понятно, спасибо!
        </button>
      </div>
    </div>
  );
}
