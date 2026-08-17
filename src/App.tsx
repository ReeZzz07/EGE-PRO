import { useEffect, useState } from "react";
import Header, { type View } from "./components/Header";
import Dashboard from "./components/Dashboard";
import TaskBank from "./components/TaskBank";
import SolveView from "./components/SolveView";
import { MistakesView, StatsView, TutorView } from "./components/MistakesStats";
import { Icon, ToastProvider } from "./components/ui";
import { ProgressProvider } from "./lib/store";
import { SUBJECTS, type Subject } from "./data/tasks";

function Footer({ onNav }: { onNav: (v: View) => void }) {
  return (
    <footer className="border-t-2 border-ink bg-night text-paper">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center border-2 border-hl text-hl">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
              </svg>
            </span>
            <span className="font-display text-[15px] font-black">ЕГЭ·ПРО</span>
          </div>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-paper/60">
            Тренажёр подготовки к ЕГЭ с ИИ-репетитором. Задания соответствуют формату Открытого банка заданий ФИПИ (fipi.ru).
            Учебный проект: не является официальным ресурсом ФИПИ или Рособрнадзора.
          </p>
          <p className="mt-4 font-mono text-[11px] text-paper/40">© 2026 · сделано для тех, кто метит на 100 баллов</p>
        </div>
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-hl">Предметы</p>
          <ul className="mt-3 space-y-2">
            {Object.values(SUBJECTS).map((s) => (
              <li key={s.id}>
                <button onClick={() => onNav({ name: "bank" })} className="link-slide text-[13px] font-semibold text-paper/75 hover:text-paper">
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-hl">Инструменты</p>
          <ul className="mt-3 space-y-2 text-[13px]">
            {([["bank", "Банк заданий"], ["tutor", "ИИ-репетитор"], ["mistakes", "Тетрадь ошибок"], ["stats", "Статистика"]] as const).map(([id, label]) => (
              <li key={id}>
                <button onClick={() => onNav({ name: id } as View)} className="link-slide flex items-center gap-2 font-semibold text-paper/75 hover:text-paper">
                  <Icon name={id === "bank" ? "list" : id === "tutor" ? "chat" : id === "mistakes" ? "alert" : "chart"} size={14} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [view, setView] = useState<View>({ name: "home" });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [view]);

  return (
    <ProgressProvider>
      <ToastProvider>
        <div className="flex min-h-screen flex-col">
          <div className="noise-layer" aria-hidden />
          <Header view={view} onNav={setView} />
          <main className="flex-1">
            {view.name === "home" && <Dashboard onNav={setView} />}
            {view.name === "bank" && <TaskBank onNav={setView} />}
            {view.name === "task" && <SolveView key={view.id} taskId={view.id} onNav={setView} />}
            {view.name === "tutor" && <TutorView onNav={setView} />}
            {view.name === "mistakes" && <MistakesView onNav={setView} />}
            {view.name === "stats" && <StatsView onNav={setView} />}
          </main>
          <Footer onNav={setView} />
        </div>
      </ToastProvider>
    </ProgressProvider>
  );
}
