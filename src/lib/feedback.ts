// Обратная связь — клиент для docker/api/feedback.js: контакты страницы /contacts, отправка формы,
// «мои обращения» и админский журнал. Валидацию и лимиты всегда проверяет сервер.
import { useEffect, useState } from "react";
import { apiFetch, isSupabaseConfigured } from "./supabase";

export type FeedbackTopic = "payment" | "bug" | "task_error" | "suggestion" | "partnership" | "other";
export type FeedbackStatus = "new" | "in_progress" | "answered" | "closed";
export type ChannelId = "whatsapp" | "telegram" | "vk";

export const FEEDBACK_TOPICS: { id: FeedbackTopic; label: string }[] = [
  { id: "payment", label: "Оплата и тарифы" },
  { id: "bug", label: "Проблема с работой сайта" },
  { id: "task_error", label: "Ошибка в задании" },
  { id: "suggestion", label: "Предложение" },
  { id: "partnership", label: "Сотрудничество" },
  { id: "other", label: "Другое" },
];
export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(FEEDBACK_TOPICS.map((t) => [t.id, t.label]));

export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "Новое", in_progress: "В работе", answered: "Отвечено", closed: "Закрыто" };
export const STATUS_ORDER: FeedbackStatus[] = ["new", "in_progress", "answered", "closed"];

export const MIN_MESSAGE = 10;
export const MAX_MESSAGE = 3000;

export interface ContactInfo {
  supportEmail: string;
  replyWithinHours: number;
  channels: { id: ChannelId; label: string; url: string }[];
}

export const FALLBACK_CONTACT_INFO: ContactInfo = { supportEmail: "support@ege-tutor.ru", replyWithinHours: 24, channels: [] };

async function errorOf(resp: Response, fallback: string): Promise<string> {
  try {
    const j = await resp.json();
    return typeof j?.error === "string" ? j.error : fallback;
  } catch {
    return fallback;
  }
}

const NET_ERROR = "Нет связи с сервером. Попробуй ещё раз.";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function loadContactInfo(): Promise<ContactInfo> {
  if (!isSupabaseConfigured) return FALLBACK_CONTACT_INFO;
  try {
    const resp = await apiFetch("/feedback/info");
    return resp.ok ? { ...FALLBACK_CONTACT_INFO, ...((await resp.json()) as ContactInfo) } : FALLBACK_CONTACT_INFO;
  } catch {
    return FALLBACK_CONTACT_INFO;
  }
}

/** Контакты для страницы /contacts, футера и т.п.: сразу есть безопасный дефолт, настоящие подтягиваются. */
export function useContactInfo(): ContactInfo {
  const [info, setInfo] = useState<ContactInfo>(FALLBACK_CONTACT_INFO);
  useEffect(() => {
    let cancelled = false;
    loadContactInfo().then((i) => {
      if (!cancelled) setInfo(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

export interface FeedbackInput {
  topic: FeedbackTopic;
  name: string;
  email: string;
  message: string;
  consent: boolean;
  taskId?: string;
  source: string;
  /** скрытое поле-ловушка для ботов — у людей всегда пустое */
  website: string;
  /** сколько миллисекунд форма была открыта — слишком быстрые отправки сервер считает ботами */
  elapsedMs: number;
}

export async function sendFeedback(input: FeedbackInput): Promise<{ id?: number | null; error?: string }> {
  try {
    const resp = await apiFetch("/feedback", json("POST", input));
    if (!resp.ok) return { error: await errorOf(resp, "Не удалось отправить обращение.") };
    return { id: ((await resp.json()) as { id: number | null }).id };
  } catch {
    return { error: NET_ERROR };
  }
}

export interface MyFeedback {
  id: number;
  topic: FeedbackTopic;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  replies: { text: string | null; at: string }[];
}

export async function loadMyFeedback(): Promise<MyFeedback[]> {
  try {
    const resp = await apiFetch("/feedback/mine");
    return resp.ok ? ((await resp.json()) as { items: MyFeedback[] }).items : [];
  } catch {
    return [];
  }
}

// ───────────── админка ─────────────

export interface AdminFeedbackItem {
  id: number;
  userId: string | null;
  email: string;
  name: string | null;
  topic: FeedbackTopic;
  message: string;
  taskId: string | null;
  source: string | null;
  context: { userAgent?: string; tariff?: string };
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  teamNotified: "ok" | "failed" | "pending";
  teamNotifyError: string | null;
  ackSent: "ok" | "failed" | "pending";
  ackError: string | null;
  overdue: boolean;
}

export type FeedbackEventType = "created" | "team_notified" | "team_notify_failed" | "ack_sent" | "ack_failed" | "status_changed" | "note_changed" | "reply_sent" | "reply_failed";

export interface AdminFeedbackDetail extends AdminFeedbackItem {
  events: { id: number; type: FeedbackEventType; data: Record<string, string>; createdAt: string; actor: string | null }[];
}

export interface FeedbackFilters {
  status?: FeedbackStatus | "open" | "";
  topic?: FeedbackTopic | "";
  q?: string;
  from?: string;
  to?: string;
  overdue?: boolean;
  delivery?: "failed" | "";
  sort?: "created" | "updated" | "status" | "topic" | "id";
  dir?: "asc" | "desc";
  page?: number;
}

export interface AdminFeedbackList {
  items: AdminFeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<FeedbackStatus, number>;
  overdue: number;
}

export async function loadAdminFeedback(f: FeedbackFilters): Promise<AdminFeedbackList | null> {
  const qs = new URLSearchParams();
  if (f.status) qs.set("status", f.status);
  if (f.topic) qs.set("topic", f.topic);
  if (f.q?.trim()) qs.set("q", f.q.trim());
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.overdue) qs.set("overdue", "1");
  if (f.delivery) qs.set("delivery", f.delivery);
  if (f.sort) qs.set("sort", f.sort);
  if (f.dir) qs.set("dir", f.dir);
  if (f.page && f.page > 1) qs.set("page", String(f.page));
  try {
    const resp = await apiFetch(`/admin/feedback?${qs}`);
    return resp.ok ? ((await resp.json()) as AdminFeedbackList) : null;
  } catch {
    return null;
  }
}

export async function loadAdminFeedbackDetail(id: number): Promise<AdminFeedbackDetail | null> {
  try {
    const resp = await apiFetch(`/admin/feedback/${id}`);
    return resp.ok ? ((await resp.json()) as AdminFeedbackDetail) : null;
  } catch {
    return null;
  }
}

export async function updateAdminFeedback(id: number, patch: { status?: FeedbackStatus; note?: string }): Promise<{ detail?: AdminFeedbackDetail; error?: string }> {
  try {
    const resp = await apiFetch(`/admin/feedback/${id}`, json("PATCH", patch));
    return resp.ok ? { detail: (await resp.json()) as AdminFeedbackDetail } : { error: await errorOf(resp, "Не удалось сохранить.") };
  } catch {
    return { error: NET_ERROR };
  }
}

export async function replyAdminFeedback(id: number, text: string): Promise<{ detail?: AdminFeedbackDetail; error?: string }> {
  try {
    const resp = await apiFetch(`/admin/feedback/${id}/reply`, json("POST", { text }));
    return resp.ok ? { detail: (await resp.json()) as AdminFeedbackDetail } : { error: await errorOf(resp, "Не удалось отправить ответ.") };
  } catch {
    return { error: NET_ERROR };
  }
}

export interface ContactSettings {
  supportEmail: string;
  /** куда приходят уведомления об отзывах (не на почту поддержки) */
  reviewNotifyEmail: string;
  channels: Record<ChannelId, { enabled: boolean; url: string }>;
}

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  hosts: string[];
}

export async function loadContactSettings(): Promise<{ settings: ContactSettings; channels: ChannelMeta[] } | null> {
  try {
    const resp = await apiFetch("/admin/feedback/settings");
    return resp.ok ? ((await resp.json()) as { settings: ContactSettings; channels: ChannelMeta[] }) : null;
  } catch {
    return null;
  }
}

export async function saveContactSettings(s: ContactSettings): Promise<{ settings?: ContactSettings; error?: string }> {
  try {
    const resp = await apiFetch("/admin/feedback/settings", json("PUT", s));
    return resp.ok ? { settings: ((await resp.json()) as { settings: ContactSettings }).settings } : { error: await errorOf(resp, "Не удалось сохранить.") };
  } catch {
    return { error: NET_ERROR };
  }
}

// ───────────── отправитель писем поддержки ─────────────

export interface SupportSender {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromAddress: string;
  /** пароль наружу не отдаётся — только факт, что он задан */
  hasPassword: boolean;
  /** с какого адреса письма поддержки уходят сейчас (null — SMTP вообще не настроен) */
  effectiveFrom: string | null;
  /** true — отдельный ящик поддержки; false — запасной вариант: основной SMTP (обычно noreply@) */
  dedicated: boolean;
}

export interface SupportSenderInput {
  host: string;
  port: number;
  user: string;
  /** пустой — оставить прежний */
  password: string;
  fromName: string;
  fromAddress: string;
}

export async function loadSupportSender(): Promise<SupportSender | null> {
  try {
    const resp = await apiFetch("/admin/feedback/sender");
    return resp.ok ? ((await resp.json()) as SupportSender) : null;
  } catch {
    return null;
  }
}

export async function saveSupportSender(input: SupportSenderInput): Promise<{ sender?: SupportSender; error?: string }> {
  try {
    const resp = await apiFetch("/admin/feedback/sender", json("PUT", input));
    return resp.ok ? { sender: (await resp.json()) as SupportSender } : { error: await errorOf(resp, "Не удалось сохранить.") };
  } catch {
    return { error: NET_ERROR };
  }
}

export async function sendSupportSenderTest(to: string): Promise<{ from?: string | null; error?: string }> {
  try {
    const resp = await apiFetch("/admin/feedback/sender/test", json("POST", { to }));
    return resp.ok ? { from: ((await resp.json()) as { from: string | null }).from } : { error: await errorOf(resp, "Не удалось отправить.") };
  } catch {
    return { error: NET_ERROR };
  }
}
