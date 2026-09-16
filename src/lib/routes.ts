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
  // /payment/return не строится через setView() изнутри приложения — на него попадают только
  // редиректом от ЮKassa (см. PaymentReturnView.tsx) — но path нужен и для симметрии с
  // pathToView ниже, и на случай, если пользователь обновит эту страницу в браузере.
  if (view.name === "payment-return") return `/payment/return?paymentId=${encodeURIComponent(view.paymentId)}`;
  // /reset-password — из письма (см. docker/api/mailer.js sendPasswordResetEmail), как и
  // payment-return, изнутри приложения на этот экран не переходят через setView().
  if (view.name === "reset-password") return `/reset-password?token=${encodeURIComponent(view.token)}`;
  return "/";
}

/** null — путь не из наших публичных роутов (см. AppShell: тогда адресная строка мягко
 *  выправляется на "/", а не остаётся показывать несуществующую страницу). search — сырой
 *  window.location.search (с "?" или без), нужен только для /payment/return: единственный
 *  роут здесь, у которого есть значимый параметр запроса, остальные — чистые пути. */
export function pathToView(pathname: string, search = ""): View | null {
  switch (pathname) {
    case "/tariffs":
      return { name: "tariffs" };
    case "/oferta":
      return { name: "legal", doc: "offer" };
    case "/privacy":
      return { name: "legal", doc: "privacy" };
    case "/payment/return": {
      const paymentId = new URLSearchParams(search).get("paymentId");
      return paymentId ? { name: "payment-return", paymentId } : null;
    }
    case "/reset-password": {
      const token = new URLSearchParams(search).get("token");
      return token ? { name: "reset-password", token } : null;
    }
    case "/":
      return { name: "landing" };
    default:
      return null;
  }
}
