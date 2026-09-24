// Рассылки из админки по фильтру списка пользователей (docker/api/campaigns.js): предпросмотр получателей,
// создание с подтверждением числа, отправка тестового письма, история и отмена.
import { apiFetch } from "./supabase";
import { EMPTY_USER_FILTERS, USER_FUNNEL_FILTERS, type AdminUserFilters, type TriState, type UserFunnelKey } from "./adminUsers";

export type CampaignKind = "verify_link" | "custom";

export interface CampaignContent {
  subject: string;
  bodyText: string;
  /** маленькая метка над приветствием */
  eyebrow: string;
  ctaLabel: string;
  /** куда ведёт кнопка: "" — главная платформы */
  ctaPath: "" | "/tariffs" | "/renew";
  footer: string;
}

export const CTA_OPTIONS: { value: CampaignContent["ctaPath"]; label: string }[] = [
  { value: "", label: "Главная платформы" },
  { value: "/tariffs", label: "Тарифы" },
  { value: "/renew", label: "Продление тарифа" },
];

export interface CampaignPreview {
  count: number;
  overLimit: boolean;
  maxRecipients: number;
  excludedRecent: number;
  sample: { id: string; email: string; full_name: string | null }[];
}

export interface CampaignSummary {
  id: string;
  created_at: string;
  finished_at: string | null;
  kind: CampaignKind;
  subject: string | null;
  status: "sending" | "done" | "cancelled";
  total: number;
  filters: Record<string, unknown>;
  q: string | null;
  exclude_recent: boolean;
  created_by_email: string | null;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface CampaignDetail extends CampaignSummary {
  problems: { email: string; status: "failed" | "skipped"; error: string | null }[];
}

/** Фильтры таблицы → тело запроса (то же, что принимает /admin/users, но в JSON). */
export function filtersToPayload(f: AdminUserFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of USER_FUNNEL_FILTERS) if (f.funnel[def.key] !== "any") out[def.key] = f.funnel[def.key];
  if (f.region) Object.assign(out, { region: f.region, regionNot: f.regionNot });
  if (f.city) Object.assign(out, { city: f.city, cityNot: f.cityNot });
  return out;
}

/** Сохранённые на сервере фильтры рассылки → вид фильтров таблицы (для отображения чипами в истории). */
export function filtersFromServer(raw: Record<string, unknown>, q?: string | null): AdminUserFilters {
  const funnel = { ...EMPTY_USER_FILTERS.funnel };
  for (const def of USER_FUNNEL_FILTERS) {
    const v = raw?.[def.key];
    if (v === "yes" || v === "no") funnel[def.key as UserFunnelKey] = v as TriState;
  }
  return {
    q: q ?? "",
    funnel,
    region: typeof raw?.region === "string" ? raw.region : "",
    regionNot: raw?.regionNot === true,
    city: typeof raw?.city === "string" ? raw.city : "",
    cityNot: raw?.cityNot === true,
  };
}

async function errorOf(resp: Response): Promise<{ error: string; code?: string; count?: number }> {
  const json = await resp.json().catch(() => ({}) as { error?: string; code?: string; count?: number });
  return { error: json.error ?? resp.statusText, code: json.code, count: json.count };
}

const post = (path: string, body: unknown) => apiFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function previewCampaign(kind: CampaignKind, filters: AdminUserFilters, excludeRecent: boolean): Promise<{ preview?: CampaignPreview; error?: string }> {
  const resp = await post("/admin/campaigns/preview", { kind, q: filters.q, filters: filtersToPayload(filters), excludeRecent });
  if (!resp.ok) return { error: (await errorOf(resp)).error };
  return { preview: (await resp.json()) as CampaignPreview };
}

/** Готовое письмо для предпросмотра: для своего письма — по тексту из формы, для ссылки подтверждения — стандартное. */
export async function renderCampaign(kind: CampaignKind, content: CampaignContent): Promise<{ subject?: string; html?: string; error?: string }> {
  const resp = await post("/admin/campaigns/render", { kind, ...content });
  if (!resp.ok) return { error: (await errorOf(resp)).error };
  return (await resp.json()) as { subject: string; html: string };
}

export async function sendCampaignTest(kind: CampaignKind, content: CampaignContent): Promise<{ error?: string }> {
  const resp = await post("/admin/campaigns/test", { kind, ...content });
  return resp.ok ? {} : { error: (await errorOf(resp)).error };
}

export interface CreateCampaignInput {
  kind: CampaignKind;
  content: CampaignContent;
  filters: AdminUserFilters;
  excludeRecent: boolean;
  confirmCount: number;
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ id?: string; total?: number; error?: string; code?: string; count?: number }> {
  const resp = await post("/admin/campaigns", {
    kind: input.kind,
    ...(input.kind === "custom" ? input.content : {}),
    q: input.filters.q,
    filters: filtersToPayload(input.filters),
    excludeRecent: input.excludeRecent,
    confirmCount: input.confirmCount,
  });
  if (!resp.ok) return errorOf(resp);
  return (await resp.json()) as { id: string; total: number };
}

export async function loadCampaigns(): Promise<{ campaigns?: CampaignSummary[]; maxRecipients?: number; recentDays?: number; error?: string }> {
  const resp = await apiFetch("/admin/campaigns");
  if (!resp.ok) return { error: (await errorOf(resp)).error };
  const json = (await resp.json()) as { campaigns: CampaignSummary[]; limits: { maxRecipients: number; recentDays: number } };
  return { campaigns: json.campaigns, maxRecipients: json.limits.maxRecipients, recentDays: json.limits.recentDays };
}

export async function loadCampaign(id: string): Promise<CampaignDetail | null> {
  const resp = await apiFetch(`/admin/campaigns/${id}`);
  return resp.ok ? ((await resp.json()) as CampaignDetail) : null;
}

export async function cancelCampaign(id: string): Promise<{ error?: string }> {
  const resp = await post(`/admin/campaigns/${id}/cancel`, {});
  return resp.ok ? {} : { error: (await errorOf(resp)).error };
}

// ─────────────── шаблоны-заготовки ───────────────

export interface CampaignPreset {
  id: "verify" | "onboarding" | "diagnostic" | "custom";
  title: string;
  hint: string;
  kind: CampaignKind;
  content: CampaignContent;
  /** какой фильтр обычно нужен для этой заготовки (кнопка «Применить фильтр» в окне рассылки) */
  suggested?: { funnel: Partial<Record<UserFunnelKey, TriState>>; label: string };
}

const blankContent: CampaignContent = { subject: "", bodyText: "", eyebrow: "напоминание", ctaLabel: "Открыть платформу →", ctaPath: "", footer: "Это разовое сообщение от ЕГЭ·ПРО — повторять его мы не будем." };

export const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    id: "verify",
    title: "Ссылка подтверждения почты",
    hint: "Стандартное письмо с новой ссылкой — тем, кто не подтвердил почту. Старые ссылки перестанут работать.",
    kind: "verify_link",
    content: blankContent,
    suggested: { funnel: { confirmed: "no" }, label: "Подтвердил аккаунт — Нет" },
  },
  {
    id: "onboarding",
    title: "Напоминание про онбординг",
    hint: "Тем, кто подтвердил почту, но не заполнил анкету подготовки.",
    kind: "custom",
    content: {
      subject: "Осталась минута — и платформа подстроится под тебя",
      eyebrow: "заполни анкету",
      bodyText: `Ты подтвердил(а) почту в ЕГЭ·ПРО, но ещё не заполнил(а) анкету подготовки — класс, цель и время в день.

Без неё персональный план и «Пробник» не знают, по какому предмету и в каком темпе тебя вести. Это займёт меньше минуты, а после сразу можно пройти диагностику и получить свой уровень.`,
      ctaLabel: "Заполнить анкету →",
      ctaPath: "",
      footer: "Это разовое сообщение от ЕГЭ·ПРО — повторять его мы не будем.",
    },
    suggested: { funnel: { confirmed: "yes", onboarded: "no" }, label: "Подтвердил аккаунт — Да, Прошёл онбординг — Нет" },
  },
  {
    id: "diagnostic",
    title: "Напоминание про диагностику",
    hint: "Тем, кто зарегистрирован и подтвердил почту, но не проходил диагностику.",
    kind: "custom",
    content: {
      subject: "Твой уровень по ЕГЭ — за 7 минут",
      eyebrow: "быстрый старт",
      bodyText: `Ты зарегистрировался(лась) в ЕГЭ·ПРО, но ещё не пробовал(а) диагностику: 8–12 заданий из открытого банка ФИПИ, около 7 минут.

По результату сразу увидишь свой уровень, сильные и слабые темы и получишь личный план: что повторить сегодня, а что подождёт. Это бесплатно.`,
      ctaLabel: "Пройти диагностику →",
      ctaPath: "",
      footer: "Это разовое сообщение от ЕГЭ·ПРО — повторять его мы не будем.",
    },
    suggested: { funnel: { confirmed: "yes", diagnostic: "no" }, label: "Подтвердил аккаунт — Да, Прошёл диагностику — Нет" },
  },
  {
    id: "custom",
    title: "Своё письмо",
    hint: "Тема и текст — свои. В тексте можно использовать {имя}.",
    kind: "custom",
    content: blankContent,
  },
];
