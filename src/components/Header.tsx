import { useState } from "react";
import type { Subject } from "../data/tasks";
import { useProgress } from "../lib/store";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";

export type View =
  | { name: "landing"; section?: string; nonce?: number }
  | { name: "auth"; mode?: "signup" | "login" }
  | { name: "onboarding"; subject?: Subject }
  | { name: "home" }
  | { name: "bank"; subject?: Subject }
  | { name: "tutor" }
  | { name: "mistakes" }
  | { name: "stats" }
  | { name: "task"; id: string }
  | { name: "diagnostic"; subject: Subject }
  | { name: "plan"; subject?: Subject }
  | { name: "mock-exam"; subject?: Subject; retryAttemptId?: number }
  | { name: "session-summary" }
  | { name: "tariffs" }
  | { name: "profile" }
  | { name: "settings" }
  | { name: "subjects" }
  | { name: "kim2027" }
  | { name: "legal"; doc: "offer" | "privacy" }
  | { name: "admin" };

/** Виды, доступные только авторизованным — неавторизованных на них не пускаем (см. AppShell). */
export const PROTECTED_VIEWS: View["name"][] = [
  "bank", "tutor", "mistakes", "stats", "task", "diagnostic", "plan", "mock-exam", "session-summary",
  "profile", "settings", "subjects", "kim2027", "admin",
];

/** Виды, доступные только администраторам (см. AppShell). */
export const ADMIN_ONLY_VIEWS: View["name"][] = ["admin"];

/** Переход к разделу лендинга (для гостевой навигации в шапке/подвале). */
export function landingSection(section?: string): View {
  return { name: "landing", section, nonce: Date.now() };
}

const NAV: { id: string; label: string; icon: string }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "bank", label: "Банк заданий", icon: "list" },
  { id: "tutor", label: "ИИ-репетитор", icon: "chat" },
  { id: "tariffs", label: "Тариф", icon: "spark" },
];

/** Пункты выпадающего меню аккаунта (открывается наведением на кнопку с именем, см. ниже) —
 *  "Ошибки" и "Статистика" раньше были в основной навигации, но чем больше личных разделов
 *  появлялось (профиль, предметы, настройки), тем очевиднее, что это одна группа "мой аккаунт",
 *  а не отдельные пункты верхнего уровня наравне с "Банк заданий". */
const ACCOUNT_MENU: { id: string; label: string; icon: string }[] = [
  { id: "profile", label: "Профиль", icon: "user" },
  { id: "stats", label: "Статистика", icon: "chart" },
  { id: "mistakes", label: "Ошибки", icon: "alert" },
  { id: "subjects", label: "Мои предметы", icon: "book" },
  { id: "settings", label: "Настройки", icon: "gear" },
];
const ACCOUNT_VIEWS: View["name"][] = ACCOUNT_MENU.map((n) => n.id) as View["name"][];

const GUEST_NAV: { section?: string; view?: View; label: string; icon: string }[] = [
  { label: "Главная", icon: "home" },
  { section: "subjects", label: "Предметы", icon: "list" },
  { section: "features", label: "Возможности", icon: "chat" },
  { section: "principle", label: "Принцип", icon: "target" },
  { view: { name: "tariffs" }, label: "Тарифы", icon: "spark" },
];

export default function Header({ view, onNav }: { view: View; onNav: (v: View) => void }) {
  const { derived } = useProgress();
  const { profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = view.name === "task" ? "bank" : view.name;

  const goTo = (name: string) => {
    onNav({ name } as View);
    setMenuOpen(false);
  };

  return (
    <header className="app-header sticky top-0 z-50 border-b-2 border-ink bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        <button onClick={() => onNav({ name: "home" })} className="group flex shrink-0 items-center gap-2.5" aria-label="На главную">
          <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-ink text-hl transition group-hover:bg-blue group-hover:border-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
            </svg>
          </span>
          <span className="hidden flex-col items-start leading-none lg:flex">
            <span className="font-display text-[15px] font-black tracking-tight">ЕГЭ·ПРО</span>
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-ink2 xl:block">тренажёр + репетитор</span>
          </span>
        </button>

        <nav className="no-scrollbar ml-1 flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto overflow-y-hidden sm:gap-1 lg:justify-start lg:gap-1">
          {profile
            ? (profile.isAdmin ? [...NAV, { id: "admin", label: "Админка", icon: "sigma" }] : NAV).map((n) => {
                const isActive = active === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => onNav({ name: n.id } as View)}
                    title={n.label}
                    aria-label={n.label}
                    className={`relative flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-2 text-[12.5px] font-bold transition-colors sm:px-2 lg:px-1.5 lg:text-[13px] ${
                      isActive ? "text-blue" : "text-ink2 hover:bg-ink/5 hover:text-ink"
                    }`}
                  >
                    <Icon name={n.icon} size={15} />
                    <span className="hidden whitespace-nowrap lg:inline">{n.label}</span>
                    {isActive && <span className="absolute inset-x-1.5 bottom-0.5 h-[2.5px] rounded-full bg-blue" aria-hidden />}
                  </button>
                );
              })
            : GUEST_NAV.map((n) => (
                <button
                  key={n.label}
                  onClick={() => onNav(n.view ?? landingSection(n.section))}
                  title={n.label}
                  aria-label={n.label}
                  className="flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-2 text-[12.5px] font-bold text-ink2 transition-colors hover:bg-ink/5 hover:text-ink sm:px-2 lg:px-1.5 lg:text-[13px]"
                >
                  <Icon name={n.icon} size={15} />
                  <span className="hidden whitespace-nowrap lg:inline">{n.label}</span>
                </button>
              ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {profile && (
            <>
              <span
                className={`hidden items-center gap-1 rounded-sm border-2 px-1.5 py-1 font-mono text-[11px] font-bold sm:flex lg:hidden lg:px-2 xl:flex ${
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
            </>
          )}
          {profile ? (
            <div className="relative" onMouseEnter={() => setMenuOpen(true)} onMouseLeave={() => setMenuOpen(false)}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                title="Аккаунт"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`flex items-center gap-1.5 rounded-sm border-2 px-1.5 py-1 text-[11px] font-bold sm:px-2 ${
                  menuOpen || ACCOUNT_VIEWS.includes(view.name) ? "border-blue text-blue" : "border-ink/20 text-ink2 hover:border-ink hover:text-ink"
                }`}
              >
                <Icon name="user" size={13} />
                <span className="hidden max-w-[80px] truncate sm:inline lg:hidden xl:inline">{profile.name || profile.email}</span>
                {derived.mistakeIds.size > 0 && <span className="h-1.5 w-1.5 rounded-full bg-red" aria-hidden />}
                <Icon name="chevronDown" size={11} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-52">
                  <div role="menu" className="sheet overflow-hidden rounded-sm py-1.5">
                    {ACCOUNT_MENU.map((n) => (
                      <button
                        key={n.id}
                        role="menuitem"
                        onClick={() => goTo(n.id)}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-bold transition-colors ${
                          view.name === n.id ? "bg-blue/8 text-blue" : "text-ink2 hover:bg-ink/5 hover:text-ink"
                        }`}
                      >
                        <Icon name={n.icon} size={15} />
                        {n.label}
                        {n.id === "mistakes" && derived.mistakeIds.size > 0 && (
                          <span className="ml-auto rounded-sm bg-red px-1 py-px font-mono text-[10px] font-bold leading-none text-white">
                            {derived.mistakeIds.size}
                          </span>
                        )}
                      </button>
                    ))}
                    <div className="my-1.5 border-t border-ink/10" aria-hidden />
                    <button
                      role="menuitem"
                      onClick={() => { signOut(); onNav({ name: "landing" }); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-bold text-red hover:bg-red/5"
                    >
                      <Icon name="x" size={15} /> Выйти
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-ink px-2.5 py-1.5 text-[11px] sm:px-3">
              Регистрация
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
