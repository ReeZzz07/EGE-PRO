import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Раньше необработанное исключение где-то в дереве компонентов роняло ВСЁ приложение в белый
 *  экран (React размонтирует всё дерево целиком, если ошибку никто не поймал) — ученик терял
 *  контекст (на каком задании, что делал) и не понимал, что случилось и что делать. Ловим на
 *  верхнем уровне (см. App.tsx) и предлагаем перезагрузить страницу — прогресс не в памяти
 *  компонента, а в localStorage/на сервере (см. lib/store.tsx), так что ничего не потеряется. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Необработанная ошибка в дереве компонентов:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
          <p className="font-display text-2xl font-bold">Что-то пошло не так</p>
          <p className="mt-3 text-sm text-ink2">
            Страница столкнулась с неожиданной ошибкой. Твой прогресс сохранён — перезагрузка страницы обычно всё исправляет.
          </p>
          <button onClick={() => window.location.reload()} className="btn btn-blue mt-6 px-5 py-2.5 text-sm">
            Перезагрузить страницу
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
