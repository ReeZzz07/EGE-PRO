import { useProgress } from "../lib/store";
import { Icon } from "./ui";

export type View = { name: "home" } | { name: "bank" } | { name: "tutor" } | { name: "mistakes" } | { name: "stats" } | { name: "task"; id: string };

const NAV: { id: string; label: string; icon: string }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "bank", label: "Банк заданий", icon: "list" },
  { id: "tutor", label: "ИИ-репетитор", icon: "chat" },
  { id: "mistakes", label: "Ошибки", icon: "alert" },
  { id: "stats", label: "Статистика", icon: "chart" },
];

export default function Header({ view, onNav }: { view: View; onNav: (v: View) => void }) {
  const { derived } = useProgress();
  const active = view.name === "task" ? "bank" : view.name;
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <button onClick={() => onNav({ name: "home" })} className="group flex items-center gap-2.5" aria-label="На главную">
          <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-ink text-hl transition group-hover:bg-blue group-hover:border-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
            </svg>
          </span>
          <span className="hidden flex-col items-start leading-none sm:flex">
            <span className="font-display text-[15px] font-black tracking-tight">ЕГЭ·ПРО</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink2">тренажёр + репетитор</span>
          </span>
        </button>

        <nav className="scrollbar-thin ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onNav({ name: n.id } as View)}
              className={`link-slide relative flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-bold transition ${
                active === n.id ? "active text-blue" : "text-ink2 hover:text-ink"
              }`}
            >
              <Icon name={n.icon} size={15} />
              <span className="hidden md:inline">{n.label}</span>
              {n.id === "mistakes" && derived.mistakeIds.size > 0 && (
                <span className="ml-0.5 rounded-sm bg-red px-1 py-px font-mono text-[10px] font-bold leading-none text-white">
                  {derived.mistakeIds.size}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`hidden items-center gap-1 rounded-sm border-2 px-2 py-1 font-mono text-[11px] font-bold sm:flex ${
              derived.streak > 0 ? "border-amber text-amber" : "border-line text-ink2"
            }`}
            title="Серия дней с верными решениями"
          >
            <Icon name="flame" size={13} />
            {derived.streak} дн
          </span>
          <span className="flex items-center gap-1.5 rounded-sm border-2 border-ink bg-ink px-2 py-1 font-mono text-[11px] font-bold text-paper">
            <Icon name="star" size={13} className="text-hl" />
            {derived.earnedPoints} п.б.
          </span>
        </div>
      </div>
    </header>
  );
}
