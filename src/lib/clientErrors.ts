import { apiFetch, isSupabaseConfigured } from "./supabase";

export type ErrorSource = "boundary" | "window" | "unhandled" | "unknown";

/** Best-effort отправка клиентской ошибки в журнал. Не бросает наружу. */
export function reportClientError(source: ErrorSource, error: unknown, extra?: { url?: string }) {
  if (!isSupabaseConfigured || typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(String(error ?? "unknown"));
  const body = {
    source,
    message: err.message || "unknown",
    stack: err.stack ?? null,
    url: extra?.url ?? window.location.href,
  };
  apiFetch("/errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

let installed = false;

/** Вешает window.onerror / unhandledrejection один раз на приложение. */
export function installClientErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    reportClientError("window", ev.error ?? ev.message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    reportClientError("unhandled", ev.reason);
  });
}

export interface ClientErrorItem {
  id: number;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
}

export async function loadClientErrors(): Promise<{ total: number; items: ClientErrorItem[] }> {
  const resp = await apiFetch("/admin/errors");
  if (!resp.ok) throw new Error("Не удалось загрузить журнал ошибок");
  return resp.json();
}

export async function clearAllClientErrors(): Promise<void> {
  const resp = await apiFetch("/admin/errors", { method: "DELETE" });
  if (!resp.ok) throw new Error("Не удалось очистить журнал");
}
