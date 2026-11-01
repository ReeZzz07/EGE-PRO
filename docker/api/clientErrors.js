// Журнал клиентских ошибок: ErrorBoundary / window.onerror / unhandledrejection → POST /errors.
// Читает только админ (GET /admin/errors). Без PII сверх user_id (если был JWT) и user-agent.
import { pool } from "./db.js";

const SOURCES = new Set(["boundary", "window", "unhandled", "unknown"]);

export function normalizeErrorBody(body) {
  const source = SOURCES.has(body?.source) ? body.source : "unknown";
  const message = String(body?.message ?? "").trim().slice(0, 2000);
  if (!message) return { error: "Пустое сообщение об ошибке" };
  return {
    source,
    message,
    stack: body?.stack != null ? String(body.stack).slice(0, 8000) : null,
    url: body?.url != null ? String(body.url).slice(0, 500) : null,
  };
}

export async function recordClientError({ userId, source, message, stack, url, userAgent }) {
  await pool.query(
    `insert into public.client_errors (user_id, source, message, stack, url, user_agent)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId ?? null, source, message, stack, url, userAgent ? String(userAgent).slice(0, 400) : null]
  );
}

export async function listClientErrors({ limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `select e.id, e.created_at, e.user_id, e.source, e.message, e.stack, e.url, e.user_agent,
            p.full_name, u.email
       from public.client_errors e
       left join public.profiles p on p.id = e.user_id
       left join auth.users u on u.id = e.user_id
      order by e.created_at desc
      limit $1 offset $2`,
    [lim, off]
  );
  const { rows: cnt } = await pool.query("select count(*)::int as n from public.client_errors");
  return {
    total: cnt[0]?.n ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      userId: r.user_id,
      userName: r.full_name ?? null,
      userEmail: r.email ?? null,
      source: r.source,
      message: r.message,
      stack: r.stack,
      url: r.url,
      userAgent: r.user_agent,
    })),
  };
}

export async function clearClientErrors() {
  await pool.query("delete from public.client_errors");
}
