import type { Subject } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";

export type View =
  | { name: "landing" }
  | { name: "auth" }
  | { name: "onboarding"; subject?: Subject }
  | { name: "home" }
  | { name: "bank" }
  | { name: "tutor" }
  | { name: "mistakes" }
  | { name: "stats" }
  | { name: "task"; id: string }
  | { name: "diagnostic"; subject: Subject }
  | { name: "plan" }
  | { name: "mock-exam" }
  | { name: "session-summary" };

const NAV: { id: string; label: string; icon: string }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "bank", label: "Банк заданий", icon: "list" },
  { id: "tutor", label: "ИИ-репетитор", icon: "chat" },
  { id: "mistakes", label: "Ошибки", icon: "alert" },
  { id: "stats", label: "Статистика", icon: "chart" },
];

export default function Header({ view, onNav }: { view: View; onNav: (v: View) => void }) {
  const { derived } = useProgress();
  const { profile, signOut } = useAuth();
  const active = view.name === "task" ? "bank" : view.name;
  return (
    <header className="app-header sticky top-0 z-50 border-b-2 border-ink bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <button onClick={() => onNav({ name: "home" })} className="group flex shrink-0 items-center gap-2.5" aria-label="На главную">
          <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-ink text-hl transition group-hover:bg-blue group-hover:border-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
            </svg>
          </span>
          <span className="hidden flex-col items-start leading-none lg:flex">
            <span className="font-display text-[15px] font-black tracking-tight">ЕГЭ·ПРО</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink2">тренажёр + репетитор</span>
          </span>
        </button>

        <nav className="no-scrollbar ml-1 flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-clip sm:gap-1 lg:justify-start lg:gap-1.5">
          {NAV.map((n) => {
            const isActive = active === n.id;
            return (
              <button
                key={n.id}
                onClick={() => onNav({ name: n.id } as View)}
                title={n.label}
                aria-label={n.label}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-2 text-[12.5px] font-bold transition-colors sm:px-2 lg:px-2.5 lg:text-[13px] ${
                  isActive ? "text-blue" : "text-ink2 hover:bg-ink/5 hover:text-ink"
                }`}
              >
                <Icon name={n.icon} size={15} />
                <span className="hidden whitespace-nowrap xl:inline">{n.label}</span>
                {n.id === "mistakes" && derived.mistakeIds.size > 0 && (
                  <span className="rounded-sm bg-red px-1 py-px font-mono text-[10px] font-bold leading-none text-white">
                    {derived.mistakeIds.size}
                  </span>
                )}
                {isActive && <span className="absolute inset-x-1.5 bottom-0.5 h-[2.5px] rounded-full bg-blue" aria-hidden />}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span
            className={`hidden items-center gap-1 rounded-sm border-2 px-1.5 py-1 font-mono text-[11px] font-bold sm:flex lg:px-2 ${
              derived.streak > 0 ? "border-amber text-amber" : "border-line text-ink2"
            }`}
            title="Серия дней с верными решениями"
          >
            <Icon name="flame" size={13} />
            {derived.streak} дн
          </span>
          <span className="flex items-center gap-1.5 rounded-sm border-2 border-ink bg-ink px-1.5 py-1 font-mono text-[11px] font-bold text-paper sm:px-2">
            <Icon name="star" size={13} className="text-hl" />
            {derived.earnedPoints} п.б.
          </span>
          {profile ? (
            <button onClick={() => { signOut(); onNav({ name: "landing" }); }} title="Выйти" className="flex items-center gap-1.5 rounded-sm border-2 border-ink/20 px-1.5 py-1 text-[11px] font-bold text-ink2 hover:border-ink hover:text-ink sm:px-2">
              <span className="hidden max-w-[80px] truncate sm:inline">{profile.name || profile.email}</span>
              <Icon name="x" size={12} />
            </button>
          ) : (
            <button onClick={() => onNav({ name: "auth" })} className="btn btn-ink px-2.5 py-1.5 text-[11px] sm:px-3">
              Войти
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
