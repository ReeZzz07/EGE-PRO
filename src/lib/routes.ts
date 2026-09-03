// Мост между состоянием View (см. App.tsx/Header.tsx) и адресной строкой браузера — только для
// горстки публичных/маркетинговых страниц, ради которых это вообще делается (SEO: до этого у всего
// сайта был единственный URL "/", поисковик физически не видел ничего дальше первого экрана).
// Внутренность приложения (банк, задание, админка и т.д.) осталась на чистой state-навигации, как
// и была, — при переходе на такие экраны адресная строка просто сворачивается обратно на "/".
//
// Сознательно без react-router: здесь нет ни одного place, где нужен настоящий роутинг/матчинг —
// весь рендер по-прежнему один большой switch по view.name в App.tsx. History API (pushState +
// popstate) для двух десятков строк логичнее, чем тащить <BrowserRouter>/<Routes> ради
// несуществующего в проекте паттерна (react-router-dom когда-то был в зависимостях неиспользуемым — убран).
import type { View } from "../components/Header";

export function viewToPath(view: View): string {
  if (view.name === "tariffs") return "/tariffs";
  if (view.name === "legal") return view.doc === "offer" ? "/oferta" : "/privacy";
  return "/";
}

/** null — путь не из наших публичных роутов (см. AppShell: тогда адресная строка мягко
 *  выправляется на "/", а не остаётся показывать несуществующую страницу). */
export function pathToView(pathname: string): View | null {
  switch (pathname) {
    case "/tariffs":
      return { name: "tariffs" };
    case "/oferta":
      return { name: "legal", doc: "offer" };
    case "/privacy":
      return { name: "legal", doc: "privacy" };
    case "/":
      return { name: "landing" };
    default:
      return null;
  }
}
