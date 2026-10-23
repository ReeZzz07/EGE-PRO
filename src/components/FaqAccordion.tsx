// Блок «Частые вопросы» аккордеоном: вопрос виден всегда, ответ раскрывается по клику. Нативный <details>: работает с клавиатуры (Enter, пробел),
// читается скринридерами, а текст ответа остаётся в HTML и у поисковых роботов. Вопрос — заголовок h3 внутри summary.
import { Icon } from "./ui";

export interface FaqEntry {
  q: string;
  a: string;
}

export default function FaqAccordion({ items, className = "mt-4 space-y-3" }: { items: FaqEntry[]; className?: string }) {
  return (
    <div className={className}>
      {items.map((f) => (
        <details key={f.q} className="sheet group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 [&::-webkit-details-marker]:hidden">
            <h3 className="font-display text-[14.5px] font-bold leading-snug">{f.q}</h3>
            <Icon name="arrowR" size={16} className="shrink-0 text-ink2 transition-transform group-open:rotate-90" />
          </summary>
          <p className="px-4 pb-4 text-[13.5px] leading-relaxed text-ink2">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
