// Просмотры, лайки, репосты и комментарии под статьями блога (docker/api/blogEngagement.js). Смотреть, лайкать,
// делиться и читать комментарии могут все, писать комментарии — только вошедшие. Посетителя без входа сервер
// различает по случайному идентификатору, который хранится в этом браузере (заголовок X-Visitor-Id).
import { apiFetch } from "./supabase";

export interface EngagementStats {
  views: number;
  likes: number;
  /** репосты в соцсети (ВК, Telegram, WhatsApp, Одноклассники); «скопировать ссылку» сюда не входит */
  shares: number;
  comments: number;
  /** поставил ли лайк этот посетитель */
  liked: boolean;
}

export interface BlogComment {
  id: number;
  author: string;
  /** комментарий редакции — подписан «Редакция ЕГЭ·ПРО» */
  staff: boolean;
  body: string;
  createdAt: string;
  /** комментарий текущего пользователя — у него есть кнопка «удалить» */
  mine: boolean;
}

export type ShareChannel = "vk" | "telegram" | "whatsapp" | "ok" | "copy";

export const COMMENT_MAX = 2000;

const VISITOR_KEY = "ege-pro.visitor-id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // запасной вариант для старых браузеров: достаточно случайный для счётчиков
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let memoryId: string | null = null;

/** Постоянный анонимный идентификатор посетителя в этом браузере (без входа он нужен для лайков и счётчиков). */
export function getVisitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && UUID_RE.test(saved)) return saved;
    const fresh = newId();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    // хранилище недоступно (приватный режим) — живёт до перезагрузки страницы
    return (memoryId ??= newId());
  }
}

const call = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("x-visitor-id", getVisitorId());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return apiFetch(path, { ...init, headers });
};

async function errorOf(resp: Response): Promise<string> {
  const json = await resp.json().catch(() => ({}) as { error?: string });
  return json.error ?? "Не удалось выполнить запрос";
}

const enc = encodeURIComponent;

/** Счётчики и первая страница комментариев. null — статьи нет среди опубликованных (черновик) или сервер недоступен. */
export async function loadEngagement(slug: string): Promise<{ stats: EngagementStats; comments: BlogComment[]; nextBeforeId: number | null } | null> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}`);
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

/** Засчитывает просмотр (сервер сам не даёт накрутить: один на посетителя в день). */
export async function registerView(slug: string): Promise<EngagementStats | null> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}/view`, { method: "POST" });
    return resp.ok ? ((await resp.json()) as { stats: EngagementStats }).stats : null;
  } catch {
    return null;
  }
}

/** Лайк: повторный вызов снимает. */
export async function toggleLike(slug: string): Promise<{ liked?: boolean; likes?: number; error?: string }> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}/like`, { method: "POST" });
    return resp.ok ? await resp.json() : { error: await errorOf(resp) };
  } catch {
    return { error: "Нет связи с сервером — попробуй ещё раз" };
  }
}

export async function registerShare(slug: string, channel: ShareChannel): Promise<EngagementStats | null> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}/share`, { method: "POST", body: JSON.stringify({ channel }) });
    return resp.ok ? ((await resp.json()) as { stats: EngagementStats }).stats : null;
  } catch {
    return null;
  }
}

export async function loadMoreComments(slug: string, beforeId: number): Promise<{ comments: BlogComment[]; nextBeforeId: number | null } | null> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}/comments?before=${beforeId}`);
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

/** Новый комментарий (нужен вход). Ошибки сервера (фильтр, лимит, длина) приходят готовым текстом. */
export async function postComment(slug: string, body: string): Promise<{ comment?: BlogComment; stats?: EngagementStats; error?: string }> {
  try {
    const resp = await call(`/blog-engagement/${enc(slug)}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    return resp.ok ? await resp.json() : { error: await errorOf(resp) };
  } catch {
    return { error: "Нет связи с сервером — попробуй ещё раз" };
  }
}

export async function removeComment(id: number): Promise<{ error?: string }> {
  try {
    const resp = await call(`/blog-engagement/comments/${id}`, { method: "DELETE" });
    return resp.ok ? {} : { error: await errorOf(resp) };
  } catch {
    return { error: "Нет связи с сервером — попробуй ещё раз" };
  }
}

/** Просмотры, лайки, репосты и комментарии всех опубликованных статей — для карточек в списке: { slug: ... }. */
export async function loadAllEngagement(): Promise<Record<string, Omit<EngagementStats, "liked">>> {
  try {
    const resp = await call("/blog-engagement/stats");
    return resp.ok ? ((await resp.json()) as { stats: Record<string, Omit<EngagementStats, "liked">> }).stats : {};
  } catch {
    return {};
  }
}

export interface AdminComment {
  id: number;
  body: string;
  createdAt: string;
  author: string;
  email: string;
  articleSlug: string;
  articleTitle: string;
}

/** Для админки: счётчики по id статьи (включая черновики) и последние комментарии для модерации. */
export async function loadAdminEngagement(): Promise<{ stats: Record<string, Omit<EngagementStats, "liked">>; comments: AdminComment[] } | null> {
  try {
    const resp = await call("/admin/blog/engagement");
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

/** Ссылка «поделиться» для канала; copy ссылкой не является. */
export function shareLink(channel: Exclude<ShareChannel, "copy">, url: string, title: string): string {
  const u = enc(url);
  const t = enc(title);
  switch (channel) {
    case "vk":
      return `https://vk.com/share.php?url=${u}&title=${t}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${t}`;
    case "whatsapp":
      return `https://wa.me/?text=${enc(`${title} ${url}`)}`;
    case "ok":
      return `https://connect.ok.ru/offer?url=${u}&title=${t}`;
  }
}

export const SHARE_LABEL: Record<Exclude<ShareChannel, "copy">, string> = { vk: "ВКонтакте", telegram: "Telegram", whatsapp: "WhatsApp", ok: "Одноклассники" };
