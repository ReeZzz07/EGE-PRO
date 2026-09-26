// Письма-напоминания (docker/api/lifecycleEmails.js): список с дефолтами и текущим текстом, сохранение,
// предпросмотр и тестовая отправка. Всё через API (не через PostgREST): дефолты и сборка письма живут на
// сервере, а тестовому письму нужен SMTP-транспорт.
import { apiFetch } from "./supabase";

export type LifecycleKind = "activation" | "plan" | "abandoned" | "expiring" | "expired";

export interface LifecycleTexts {
  subject: string;
  bodyText: string;
  /** пометка внизу письма (может быть пустой) */
  footer: string;
}

export interface LifecycleTemplate {
  kind: LifecycleKind;
  title: string;
  /** когда письмо уходит */
  when: string;
  /** какие {подстановки} доступны в теме и тексте */
  placeholders: string[];
  defaults: LifecycleTexts;
  current: LifecycleTexts;
}

async function errorOf(resp: Response): Promise<string> {
  const json = await resp.json().catch(() => ({}) as { error?: string });
  return json.error ?? resp.statusText;
}

export async function loadLifecycleTemplates(): Promise<{ templates?: LifecycleTemplate[]; error?: string }> {
  const resp = await apiFetch("/admin/lifecycle-email");
  if (!resp.ok) return { error: await errorOf(resp) };
  return { templates: ((await resp.json()) as { templates: LifecycleTemplate[] }).templates };
}

const post = (path: string, method: string, body: unknown) =>
  apiFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function saveLifecycleTemplate(kind: LifecycleKind, t: LifecycleTexts): Promise<{ error?: string }> {
  const resp = await post(`/admin/lifecycle-email/${kind}`, "PUT", t);
  return resp.ok ? {} : { error: await errorOf(resp) };
}

/** Готовый HTML письма с образцовыми данными и текстом ИЗ ФОРМЫ (даже несохранённым). */
export async function previewLifecycleTemplate(kind: LifecycleKind, t: LifecycleTexts): Promise<{ subject?: string; html?: string; error?: string }> {
  const resp = await post(`/admin/lifecycle-email/${kind}/preview`, "POST", t);
  if (!resp.ok) return { error: await errorOf(resp) };
  return (await resp.json()) as { subject: string; html: string };
}

export async function sendTestLifecycleEmail(kind: LifecycleKind, t: LifecycleTexts): Promise<{ error?: string }> {
  const resp = await post(`/admin/lifecycle-email/${kind}/test`, "POST", t);
  return resp.ok ? {} : { error: await errorOf(resp) };
}
