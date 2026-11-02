// Мост между состоянием View (см. App.tsx/Header.tsx) и адресной строкой браузера.
// Публичные/маркетинговые страницы — для SEO. Кабинет — под /app/* (deep link, F5, шаринг
// задания), без react-router: History API + switch по view.name в App.tsx.
import type { View } from "../components/Header";
import { subjectBySlug, subjectPagePath } from "./subjectPage";
import type { Subject } from "../data/tasks";

const SUBJECTS_RE = /^(math|rus|inf|fiz|soc|bio|eng|geo|chem|hist|lit|math_base)$/;

function asSubject(raw: string): Subject | null {
  return SUBJECTS_RE.test(raw) ? (raw as Subject) : null;
}

export function viewToPath(view: View): string {
  if (view.name === "tariffs") return "/tariffs";
  if (view.name === "renew") return "/renew";
  if (view.name === "subjects") return "/subjects";
  if (view.name === "plan") return "/plan";
  if (view.name === "diagnostic") return "/diagnostic";
  if (view.name === "review") return "/review";
  if (view.name === "contacts") return "/contacts";
  if (view.name === "legal") return view.doc === "offer" ? "/oferta" : "/privacy";
  if (view.name === "parents") return "/parents";
  if (view.name === "parent-pay") return `/pay-for/${encodeURIComponent(view.token)}${view.paymentId ? `?paymentId=${encodeURIComponent(view.paymentId)}` : ""}`;
  if (view.name === "subject-page") return subjectPagePath(view.subject);
  if (view.name === "blog") return "/blog";
  if (view.name === "blog-article") return `/blog/${encodeURIComponent(view.slug)}`;
  if (view.name === "payment-return") return `/payment/return?paymentId=${encodeURIComponent(view.paymentId)}`;
  if (view.name === "reset-password") return `/reset-password?token=${encodeURIComponent(view.token)}`;
  if (view.name === "verify-email") return `/verify-email?token=${encodeURIComponent(view.token)}`;
  if (view.name === "try") return view.subject ? `/try/${view.subject}` : "/try";

  // ─── кабинет (/app/*) ───
  if (view.name === "home") return "/app";
  if (view.name === "bank") return view.subject ? `/app/bank/${view.subject}` : "/app/bank";
  if (view.name === "task") return `/app/task/${encodeURIComponent(view.id)}`;
  if (view.name === "tutor") return "/app/tutor";
  if (view.name === "mistakes") return "/app/mistakes";
  if (view.name === "stats") return "/app/stats";
  if (view.name === "mock-exam") return view.subject ? `/app/mock-exam/${view.subject}` : "/app/mock-exam";
  if (view.name === "profile") return "/app/profile";
  if (view.name === "settings") return "/app/settings";
  if (view.name === "admin") return "/app/admin";
  if (view.name === "teacher") return "/app/teacher";
  if (view.name === "kim2027") return "/app/kim2027";
  if (view.name === "session-summary") return "/app/session-summary";

  // онбординг/auth/landing/check-email — без отдельного «красивого» URL (кроме /onboarding из писем)
  return "/";
}

/** null — путь не из наших роутов (см. AppShell: тогда адресная строка мягко
 *  выправляется на "/", а не остаётся показывать несуществующую страницу). */
export function pathToView(pathname: string, search = ""): View | null {
  if (pathname.startsWith("/pay-for/")) {
    const token = pathname.slice("/pay-for/".length);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    return { name: "parent-pay", token, paymentId: new URLSearchParams(search).get("paymentId") ?? undefined };
  }
  if (pathname.startsWith("/ege/")) {
    const subject = subjectBySlug(pathname.slice("/ege/".length));
    return subject ? { name: "subject-page", subject } : null;
  }
  if (pathname === "/blog") return { name: "blog" };
  if (pathname.startsWith("/blog/")) {
    const rest = pathname.slice("/blog/".length);
    if (!rest || rest.includes("/")) return null;
    try {
      return { name: "blog-article", slug: decodeURIComponent(rest) };
    } catch {
      return null;
    }
  }

  // /app и /app/...
  if (pathname === "/app" || pathname === "/app/") return { name: "home" };
  if (pathname === "/app/bank") return { name: "bank" };
  if (pathname.startsWith("/app/bank/")) {
    const subject = asSubject(pathname.slice("/app/bank/".length));
    return subject ? { name: "bank", subject } : null;
  }
  if (pathname.startsWith("/app/task/")) {
    const rest = pathname.slice("/app/task/".length);
    if (!rest || rest.includes("/")) return null;
    try {
      return { name: "task", id: decodeURIComponent(rest) };
    } catch {
      return null;
    }
  }
  if (pathname === "/app/tutor") return { name: "tutor" };
  if (pathname === "/app/mistakes") return { name: "mistakes" };
  if (pathname === "/app/stats") return { name: "stats" };
  if (pathname === "/app/mock-exam") return { name: "mock-exam" };
  if (pathname.startsWith("/app/mock-exam/")) {
    const subject = asSubject(pathname.slice("/app/mock-exam/".length));
    return subject ? { name: "mock-exam", subject } : null;
  }
  if (pathname === "/app/profile") return { name: "profile" };
  if (pathname === "/app/settings") return { name: "settings" };
  if (pathname === "/app/admin") return { name: "admin" };
  if (pathname === "/app/teacher") return { name: "teacher" };
  if (pathname === "/app/kim2027") return { name: "kim2027" };
  if (pathname === "/app/session-summary") return { name: "session-summary" };

  switch (pathname) {
    case "/tariffs":
      return { name: "tariffs" };
    case "/renew":
      return { name: "renew" };
    case "/onboarding":
      return { name: "onboarding" };
    case "/subjects":
      return { name: "subjects" };
    case "/plan":
      return { name: "plan" };
    case "/diagnostic":
      return { name: "diagnostic" };
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
    case "/try":
      return { name: "try" };
    case "/":
      return { name: "landing" };
    default: {
      if (pathname.startsWith("/try/")) {
        const subject = asSubject(pathname.slice("/try/".length));
        return subject ? { name: "try", subject } : null;
      }
      return null;
    }
  }
}
