// Раньше — тонкая обёртка над @supabase/supabase-js (облачный Supabase). Теперь бэкенд —
// свой стек в Docker (Postgres + PostgREST + собственный auth/storage/ai-tutor, см. docker-compose.yml
// и docker/api). Чтобы не переписывать весь остальной фронтенд, `supabase` здесь — совместимый шим:
// `.from()` — настоящий PostgrestClient (протокол идентичен supabase-js, ничего не меняли),
// `.auth`/`.storage`/`.functions` — свои реализации поверх docker/api под теми же именами методов,
// которые уже вызываются в auth.tsx/adminTasks.ts/dbTasks.ts/aiTutor.ts.
import { PostgrestClient } from "@supabase/postgrest-js";

export const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/** true, если бэкенд (Docker-стек) сконфигурирован */
export const isSupabaseConfigured = !!url;

const SESSION_KEY = "ege-pro.local-session.v1";

type SessionUser = { id: string; email: string; user_metadata?: { full_name?: string } };
type Session = { access_token: string; user: SessionUser } | null;
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT";
type AuthListener = (event: AuthEvent, session: Session) => void;

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return {};
  }
}

function loadSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session?.access_token) return null;
    const claims = decodeJwt(session.access_token);
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

let currentSession: Session = loadSession();
const listeners = new Set<AuthListener>();

function setSession(session: Session, event: AuthEvent) {
  currentSession = session;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb(event, session);
}

/** Прямой fetch к своему бэкенду (не через .from()/PostgREST) — с автоподстановкой Bearer-токена.
 *  Нужен для эндпоинтов вроде /admin/import-archive, которых нет в протоколе supabase-js. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (currentSession?.access_token) headers.set("Authorization", `Bearer ${currentSession.access_token}`);
  return fetch(`${url}${path}`, { ...init, headers });
}

const authShim = {
  async getSession() {
    return { data: { session: currentSession } };
  },
  onAuthStateChange(cb: AuthListener) {
    listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
    const resp = await apiFetch("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, full_name: options?.data?.full_name ?? "" }),
    });
    const json = await resp.json();
    if (!resp.ok) return { data: { user: null }, error: json.error ?? { message: resp.statusText } };
    const session = { access_token: json.access_token, user: { ...json.data.user, user_metadata: { full_name: options?.data?.full_name ?? "" } } };
    setSession(session, "SIGNED_IN");
    return { data: { user: session.user }, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const resp = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? { message: resp.statusText } };
    const session = { access_token: json.access_token, user: json.data.user };
    setSession(session, "SIGNED_IN");
    return { error: null };
  },
  async signOut() {
    setSession(null, "SIGNED_OUT");
    return { error: null };
  },
  async deleteAccount(password: string) {
    const resp = await apiFetch("/auth/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    if (!resp.ok) return { error: json.error ?? { message: resp.statusText } };
    setSession(null, "SIGNED_OUT");
    return { error: null };
  },
  async changePassword(currentPassword: string, newPassword: string) {
    const resp = await apiFetch("/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const json = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    if (!resp.ok) return { error: json.error ?? { message: resp.statusText } };
    return { error: null };
  },
  async changeEmail(password: string, newEmail: string) {
    const resp = await apiFetch("/auth/change-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, newEmail }),
    });
    const json = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    if (!resp.ok) return { error: json.error ?? { message: resp.statusText } };
    // свежий токен — иначе до следующего входа клиент продолжал бы слать токен со старым email
    // в payload (см. комментарий у самого роута в docker/api/server.js)
    const session = { access_token: json.access_token, user: json.data.user };
    setSession(session, "SIGNED_IN");
    return { error: null };
  },
};

function storageFrom(bucket: string) {
  return {
    getPublicUrl(path: string) {
      return { data: { publicUrl: `${url}/storage/${bucket}/${path}` } };
    },
    async upload(path: string, file: File | Blob, _opts?: { contentType?: string; upsert?: boolean }) {
      const form = new FormData();
      form.append("bucket", bucket);
      form.append("path", path);
      form.append("file", file, (file as File).name ?? "upload");
      const resp = await apiFetch("/storage/upload", { method: "POST", body: form });
      if (!resp.ok) return { error: await resp.json().catch(() => ({ message: resp.statusText })) };
      return { error: null };
    },
    async remove(paths: string[]) {
      const resp = await apiFetch("/storage/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucket, paths }),
      });
      if (!resp.ok) return { error: await resp.json().catch(() => ({ message: resp.statusText })) };
      return { error: null };
    },
    async list(prefix?: string) {
      const resp = await apiFetch(`/storage/list?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix ?? "")}`);
      const json = await resp.json();
      return { data: json.items ?? [], error: resp.ok ? null : json };
    },
  };
}

const functionsShim = {
  async invoke(name: string, opts: { body?: unknown } = {}) {
    const resp = await apiFetch(`/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body ?? {}) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) return { data: null, error: json.error ?? { message: resp.statusText } };
    return { data: json, error: null };
  },
};

const postgrest = isSupabaseConfigured
  ? new PostgrestClient(`${url}/rest/v1`, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (currentSession?.access_token) headers.set("Authorization", `Bearer ${currentSession.access_token}`);
        return fetch(input, { ...init, headers });
      },
    })
  : null;

/** Совместимый с прежним supabase-js подмножеством клиент — .from()/.auth/.storage/.functions. */
export const supabase = isSupabaseConfigured
  ? {
      from: postgrest!.from.bind(postgrest),
      auth: authShim,
      storage: { from: storageFrom },
      functions: functionsShim,
    }
  : null;
