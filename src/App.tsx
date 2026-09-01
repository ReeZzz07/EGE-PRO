import { useEffect, useRef, useState } from "react";
import Header, { ADMIN_ONLY_VIEWS, PROTECTED_VIEWS, landingSection, type View } from "./components/Header";
import AdminContent from "./components/AdminContent";
import Dashboard from "./components/Dashboard";
import TaskBank from "./components/TaskBank";
import SolveView from "./components/SolveView";
import { MistakesView, StatsView, TutorView } from "./components/MistakesStats";
import { Icon, ToastProvider } from "./components/ui";
import { ProgressProvider } from "./lib/store";
import { AuthProvider, useAuth } from "./lib/auth";
import { SUBJECTS } from "./data/tasks";
import Landing from "./components/Landing";
import OnboardingFlow from "./components/OnboardingFlow";
import AuthScreen from "./components/AuthScreen";
import DiagnosticView from "./components/DiagnosticView";
import PlanView from "./components/PlanView";
import MockExam from "./components/MockExam";
import SessionSummary from "./components/SessionSummary";
import Tariffs from "./components/Tariffs";
import LegalDoc from "./components/LegalDoc";

function Footer({ onNav }: { onNav: (v: View) => void }) {
  const { profile } = useAuth();
  return (
    <footer className="border-t-2 border-ink bg-night text-paper">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
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
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide text-[11.5px] text-paper/50 hover:text-paper/80">Публичная оферта</button>
            <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide text-[11.5px] text-paper/50 hover:text-paper/80">Политика конфиденциальности</button>
          </div>
        </div>
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-hl">Предметы</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {Object.values(SUBJECTS).map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onNav(profile ? { name: "bank", subject: s.id } : { name: "onboarding", subject: s.id })}
                  className="link-slide block w-full text-left text-[13px] font-semibold leading-snug text-paper/75 hover:text-paper break-words"
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {profile ? (
            <>
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
            </>
          ) : (
            <>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-hl">Разделы</p>
              <ul className="mt-3 space-y-2 text-[13px]">
                <li>
                  <button onClick={() => onNav(landingSection("features"))} className="link-slide flex items-center gap-2 font-semibold text-paper/75 hover:text-paper">
                    <Icon name="chat" size={14} /> Возможности
                  </button>
                </li>
                <li>
                  <button onClick={() => onNav(landingSection("principle"))} className="link-slide flex items-center gap-2 font-semibold text-paper/75 hover:text-paper">
                    <Icon name="target" size={14} /> Принцип платформы
                  </button>
                </li>
                <li>
                  <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="link-slide flex items-center gap-2 font-semibold text-paper/75 hover:text-paper">
                    <Icon name="star" size={14} /> Регистрация
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}

const VIEW_KEY = "ege-pro.lastView.v1";
/** Экраны, которые не имеет смысла восстанавливать после перезагрузки страницы (переходные/гостевые). */
const NON_RESUMABLE_VIEWS: View["name"][] = ["landing", "auth", "onboarding", "session-summary"];

function loadPersistedView(): View | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as View;
    if (!v?.name || NON_RESUMABLE_VIEWS.includes(v.name)) return null;
    return v;
  } catch {
    return null;
  }
}

function persistView(v: View) {
  try {
    if (NON_RESUMABLE_VIEWS.includes(v.name)) localStorage.removeItem(VIEW_KEY);
    else localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function AppShell() {
  const [view, setViewRaw] = useState<View>({ name: "landing" });
  const { profile, loading } = useAuth();
  const restoredRef = useRef(false);

  // обновление страницы посреди задания/банка/статистики раньше всегда кидало на главную —
  // не по кнопке пользователя, а просто потому что view нигде не сохранялся. Сохраняем и
  // восстанавливаем при следующей загрузке (для авторизованных — см. эффект ниже).
  const setView = (v: View) => {
    persistView(v);
    setViewRaw(v);
  };

  useEffect(() => {
    if (view.name === "landing" && view.section) return; // Landing сама проскроллит к разделу
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [view]);

  // как только подгрузилась активная сессия — уводим с лендинга в кабинет (или восстанавливаем
  // тот экран, на котором пользователь был до перезагрузки страницы)
  useEffect(() => {
    if (loading || !profile || view.name !== "landing") return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      const persisted = loadPersistedView();
      if (persisted) {
        setViewRaw(persisted);
        return;
      }
    }
    setViewRaw({ name: "home" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile]);

  // неавторизованных не пускаем на разделы, требующие аккаунта (см. PROTECTED_VIEWS)
  useEffect(() => {
    if (!loading && !profile && PROTECTED_VIEWS.includes(view.name)) setView({ name: "landing" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile, view.name]);

  // разделы админки — только для администраторов
  useEffect(() => {
    if (!loading && profile && !profile.isAdmin && ADMIN_ONLY_VIEWS.includes(view.name)) setView({ name: "home" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile, view.name]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="font-mono text-[13px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="noise-layer" aria-hidden />
      <Header view={view} onNav={setView} />
      <main className="flex-1">
        {view.name === "landing" && (
          <Landing
            onStart={(subject) => setView({ name: "onboarding", subject })}
            onLogin={() => setView({ name: "auth", mode: "login" })}
            scrollTo={view.section}
            scrollNonce={view.nonce}
          />
        )}

        {view.name === "auth" && (
          <AuthScreen onSuccess={() => setView({ name: "home" })} initialMode={view.mode} onNav={setView} />
        )}

        {view.name === "onboarding" && (
          <OnboardingFlow
            initialSubject={view.subject}
            onFinishToDiagnostic={(subject) => setView({ name: "diagnostic", subject })}
            onFinishToBank={() => setView({ name: "bank" })}
            onNav={setView}
          />
        )}

        {view.name === "home" && (
          profile ? <Dashboard onNav={setView} /> : <Landing onStart={(subject) => setView({ name: "onboarding", subject })} onLogin={() => setView({ name: "auth" })} />
        )}

        {view.name === "bank" && <TaskBank onNav={setView} initialSubject={view.subject} />}
        {view.name === "task" && <SolveView key={view.id} taskId={view.id} onNav={setView} />}
        {view.name === "tutor" && <TutorView onNav={setView} />}
        {view.name === "mistakes" && <MistakesView onNav={setView} />}
        {view.name === "stats" && <StatsView onNav={setView} />}

        {view.name === "diagnostic" && (
          <DiagnosticView subject={view.subject} onFinish={() => setView({ name: "plan" })} onSkip={() => setView({ name: "bank" })} />
        )}

        {view.name === "plan" && (
          profile?.primarySubject ? (
            <PlanView subject={profile.primarySubject} onStartTraining={(taskId) => setView({ name: "task", id: taskId })} onSkipToBank={() => setView({ name: "bank" })} />
          ) : (
            <div className="mx-auto max-w-xl px-4 py-16 text-center">
              <p className="font-display text-xl font-bold">План пока не построен</p>
              <p className="mt-2 text-[13.5px] text-ink2">Пройди короткий онбординг и диагностику — тогда появится персональный план.</p>
              <button onClick={() => setView({ name: "onboarding" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">Начать</button>
            </div>
          )
        )}

        {view.name === "mock-exam" && (
          profile?.primarySubject ? (
            <MockExam subject={profile.primarySubject} onFinish={() => setView({ name: "session-summary" })} onExit={() => setView({ name: "home" })} />
          ) : (
            <div className="mx-auto max-w-xl px-4 py-16 text-center">
              <p className="font-display text-xl font-bold">Сначала выбери предмет</p>
              <p className="mt-2 text-[13.5px] text-ink2">Пробник строится по предмету из онбординга.</p>
              <button onClick={() => setView({ name: "onboarding" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">Начать онбординг</button>
            </div>
          )
        )}

        {view.name === "session-summary" && <SessionSummary onNav={setView} />}
        {view.name === "tariffs" && <Tariffs onNav={setView} />}
        {view.name === "legal" && <LegalDoc doc={view.doc} onNav={setView} />}
        {view.name === "admin" && profile?.isAdmin && <AdminContent onNav={setView} />}
      </main>
      <Footer onNav={setView} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ProgressProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </ProgressProvider>
    </AuthProvider>
  );
}
