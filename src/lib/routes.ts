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
  // /renew — продление тарифа «как было»: сюда ведут письма о сроке тарифа (docker/api/mailer.js)
  if (view.name === "renew") return "/renew";
  // /subjects, /plan — см. pathToView ниже
  if (view.name === "subjects") return "/subjects";
  if (view.name === "plan") return "/plan";
  if (view.name === "diagnostic") return "/diagnostic";
  // /review — «Мой отзыв»: сюда ведёт письмо с просьбой об отзыве (docker/api/lifecycleEmails.js)
  if (view.name === "review") return "/review";
  // /contacts — контакты и форма обратной связи (публичная страница, есть в sitemap.xml)
  if (view.name === "contacts") return "/contacts";
  if (view.name === "legal") return view.doc === "offer" ? "/oferta" : "/privacy";
  // /parents — страница для родителей (публичная, есть в sitemap.xml)
  if (view.name === "parents") return "/parents";
  // /pay-for/<токен> — страница родителя, куда ведёт ссылка от ученика («попросить родителя оплатить»);
  // ?paymentId= — возврат после оплаты. Токен — длинная случайная строка, поэтому без encodeURIComponent
  // его не ломаем: base64url безопасен для пути.
  if (view.name === "parent-pay") return `/pay-for/${encodeURIComponent(view.token)}${view.paymentId ? `?paymentId=${encodeURIComponent(view.paymentId)}` : ""}`;
  if (view.name === "blog") return "/blog";
  if (view.name === "blog-article") return `/blog/${encodeURIComponent(view.slug)}`;
  // /payment/return не строится через setView() изнутри приложения — на него попадают только
  // редиректом от ЮKassa (см. PaymentReturnView.tsx) — но path нужен и для симметрии с
  // pathToView ниже, и на случай, если пользователь обновит эту страницу в браузере.
  if (view.name === "payment-return") return `/payment/return?paymentId=${encodeURIComponent(view.paymentId)}`;
  // /reset-password — из письма (см. docker/api/mailer.js sendPasswordResetEmail), как и
  // payment-return, изнутри приложения на этот экран не переходят через setView().
  if (view.name === "reset-password") return `/reset-password?token=${encodeURIComponent(view.token)}`;
  // /verify-email — из письма подтверждения (см. docker/api/server.js POST /auth/signup), та же
  // логика, что и у reset-password выше.
  if (view.name === "verify-email") return `/verify-email?token=${encodeURIComponent(view.token)}`;
  return "/";
}

/** null — путь не из наших публичных роутов (см. AppShell: тогда адресная строка мягко
 *  выправляется на "/", а не остаётся показывать несуществующую страницу). search — сырой
 *  window.location.search (с "?" или без), нужен только для /payment/return: единственный
 *  роут здесь, у которого есть значимый параметр запроса, остальные — чистые пути. */
export function pathToView(pathname: string, search = ""): View | null {
  // /blog/:slug — единственный путь здесь с переменным сегментом, обрабатываем до switch ниже, не
  // трогая его: точный "/blog" — список, "/blog/<slug>" — статья (ровно один плоский сегмент, без
  // вложенных "/" — вложенный путь или пустой хвост не наш формат).
  if (pathname.startsWith("/pay-for/")) {
    const token = pathname.slice("/pay-for/".length);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    return { name: "parent-pay", token, paymentId: new URLSearchParams(search).get("paymentId") ?? undefined };
  }
  if (pathname === "/blog") return { name: "blog" };
  if (pathname.startsWith("/blog/")) {
    const rest = pathname.slice("/blog/".length);
    if (!rest || rest.includes("/")) return null;
    try {
      return { name: "blog-article", slug: decodeURIComponent(rest) };
    } catch {
      return null; // битый %-escape
    }
  }
  switch (pathname) {
    case "/tariffs":
      return { name: "tariffs" };
    case "/renew":
      return { name: "renew" };
    // /onboarding — ссылка из письма-напоминания «заполни анкету» (см. AppShell: без входа сначала вход)
    case "/onboarding":
      return { name: "onboarding" };
    // /subjects — ссылка из письма «оплата докупки предметов не завершена» (см. lifecycle.js)
    case "/subjects":
      return { name: "subjects" };
    // /plan — ссылка из письма-напоминания «твой план ждёт» (см. lifecycle.js); subject не в пути —
    // PlanView сама берёт effectivePrimarySubject(profile), как и обычная внутренняя навигация на план
    case "/plan":
      return { name: "plan" };
    // /diagnostic — ссылка из письма-напоминания «пройди диагностику» (рассылка по фильтру, см.
    // AdminCampaignComposer.tsx); subject не в пути — App.tsx сам берёт effectivePrimarySubject(profile),
    // как и /plan выше
    case "/diagnostic":
      return { name: "diagnostic" };
    // /review — ссылка из письма-просьбы об отзыве (см. lifecycle.js); без входа — сначала вход (см. AppShell)
    case "/review":
      return { name: "review" };
    case "/contacts":
      return { name: "contacts" };
    case "/parents":
      return { name: "parents" };
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
    case "/verify-email": {
      const token = new URLSearchParams(search).get("token");
      return token ? { name: "verify-email", token } : null;
    }
    case "/":
      return { name: "landing" };
    default:
      return null;
  }
}
