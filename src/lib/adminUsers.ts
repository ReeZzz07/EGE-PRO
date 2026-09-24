// Админка → «Пользователи» — просмотр/поиск, правка (тариф, срок действия, персональная скидка),
// и действия, которые требует 152-ФЗ по запросу субъекта персональных данных: полная выгрузка,
// анонимизация, удаление. Всё идёт через docker/api (не PostgREST напрямую, см. adminUsers.js) —
// эти операции нужны привилегии выше, чем даёт RLS обычной authenticated-роли (см. миграцию
// 0023_admin_user_management.sql — новые поля профиля намеренно недоступны на запись через PostgREST).
import { apiFetch, isSupabaseConfigured } from "./supabase";

export interface AdminUserListItem {
  id: string;
  email: string;
  registered_at: string;
  full_name: string | null;
  tariff_id: string;
  tariff_expires_at: string | null;
  is_admin: boolean;
  discount_percent: number | null;
  anonymized_at: string | null;
  tariff_active: boolean;
  region: string | null;
  city: string | null;
  /** флаги воронки — то же, что фильтры списка (см. USER_FUNNEL_FILTERS) */
  confirmed: boolean;
  onboarded: boolean;
  diagnostic: boolean;
  first_task: boolean;
  ai_request: boolean;
  paid: boolean;
  abandoned: boolean;
}

/** Булевы фильтры воронки: ключ совпадает с параметром запроса и с полем строки списка. Для каждого
 *  фильтра есть «да» и «нет» (инверсия — противоположная выборка). */
export const USER_FUNNEL_FILTERS = [
  { key: "confirmed", label: "Подтвердил аккаунт", short: "Почта", hint: "подтвердил почту по ссылке из письма" },
  { key: "onboarded", label: "Прошёл онбординг", short: "Онбординг", hint: "дошёл до конца онбординга" },
  { key: "diagnostic", label: "Прошёл диагностику", short: "Диагностика", hint: "завершил хотя бы одну диагностику" },
  { key: "first_task", label: "Решил первую задачу", short: "1-я задача", hint: "есть хотя бы одна попытка решения" },
  { key: "ai_request", label: "Отправил запрос ИИ-репетитору", short: "ИИ", hint: "отправил хотя бы одно сообщение ИИ-репетитору" },
  { key: "paid", label: "Совершил платёж", short: "Оплата", hint: "есть хотя бы один успешный платёж" },
  { key: "abandoned", label: "Начал, но не завершил платёж", short: "Не доплатил", hint: "создавал платёж, но не оплатил (и ни разу не платил успешно)" },
] as const;

export type UserFunnelKey = (typeof USER_FUNNEL_FILTERS)[number]["key"];
/** any — фильтр выключен, yes — условие выполнено, no — инверсия (условие НЕ выполнено) */
export type TriState = "any" | "yes" | "no";

export interface AdminUserFilters {
  q: string;
  funnel: Record<UserFunnelKey, TriState>;
  region: string;
  /** true — «не из этого региона» (инверсия) */
  regionNot: boolean;
  city: string;
  cityNot: boolean;
}

export const EMPTY_USER_FILTERS: AdminUserFilters = {
  q: "",
  funnel: { confirmed: "any", onboarded: "any", diagnostic: "any", first_task: "any", ai_request: "any", paid: "any", abandoned: "any" },
  region: "",
  regionNot: false,
  city: "",
  cityNot: false,
};

/** сколько условий включено (без строки поиска) — для счётчика на кнопке «Фильтры» */
export function activeFilterCount(f: AdminUserFilters): number {
  return Object.values(f.funnel).filter((v) => v !== "any").length + (f.region ? 1 : 0) + (f.city ? 1 : 0);
}

export type UserSortKey = "registered" | "name" | "email" | "tariff";

export interface AdminUserFacets {
  regions: { value: string; count: number }[];
  cities: { value: string; region: string | null; count: number }[];
}

export interface AdminUserSubject {
  subject: string;
  added_at: string;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  registered_at: string;
  email_confirmed_at: string | null;
  full_name: string | null;
  grade: string | null;
  exam_year: number | null;
  goal: string | null;
  daily_minutes: number | null;
  primary_subject: string | null;
  onboarded_at: string | null;
  region: string | null;
  city: string | null;
  school: string | null;
  age: number | null;
  gender: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  tariff_id: string;
  tariff_activated_at: string | null;
  tariff_expires_at: string | null;
  extra_subjects: number;
  discount_percent: number | null;
  anonymized_at: string | null;
  tariff_name: string | null;
  tariff_price_rub: number | null;
  tariff_active: boolean;
  subjects: AdminUserSubject[];
  activity: {
    attempts: { count: number; first_at: string | null; last_at: string | null };
    diagnostics: { count: number; first_at: string | null };
    ai: { count: number; first_at: string | null };
  };
  payments: AdminUserPayment[];
}

export interface AdminUserPayment {
  id: string;
  tariff_id: string;
  amount_rub: string | number;
  status: "pending" | "succeeded" | "canceled";
  kind: "tariff" | "renewal" | "addon";
  extra_subjects: number;
  created_at: string;
}

export interface AdminUserPatch {
  fullName?: string;
  email?: string;
  tariffId?: string;
  tariffExpiresAt?: string | null;
  discountPercent?: number | null;
  isAdmin?: boolean;
}

export interface AdminUserSearchResult {
  rows: AdminUserListItem[];
  total: number;
  /** всего пользователей в базе (без фильтров) */
  overall: number;
}

export async function searchAdminUsers(
  filters: AdminUserFilters,
  page: number,
  pageSize: number,
  sort: UserSortKey = "registered",
  dir: "asc" | "desc" = "desc"
): Promise<AdminUserSearchResult> {
  if (!isSupabaseConfigured) return { rows: [], total: 0, overall: 0 };
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, dir });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const [key, v] of Object.entries(filters.funnel)) if (v !== "any") params.set(key, v);
  if (filters.region) {
    params.set("region", filters.region);
    if (filters.regionNot) params.set("regionNot", "1");
  }
  if (filters.city) {
    params.set("city", filters.city);
    if (filters.cityNot) params.set("cityNot", "1");
  }
  const resp = await apiFetch(`/admin/users?${params}`);
  if (!resp.ok) throw new Error(await readError(resp));
  return resp.json();
}

/** Регионы и города, которые реально есть у пользователей — для выпадающих списков фильтра. */
export async function loadAdminUserFacets(): Promise<AdminUserFacets> {
  if (!isSupabaseConfigured) return { regions: [], cities: [] };
  const resp = await apiFetch("/admin/users-facets");
  if (!resp.ok) return { regions: [], cities: [] };
  return resp.json();
}

export async function loadAdminUserDetail(id: string): Promise<AdminUserDetail | null> {
  const resp = await apiFetch(`/admin/users/${id}`);
  if (!resp.ok) return null;
  return resp.json();
}

async function readError(resp: Response): Promise<string> {
  const json = await resp.json().catch(() => ({}) as { error?: string });
  return json.error ?? resp.statusText;
}

export async function updateAdminUser(id: string, patch: AdminUserPatch): Promise<{ error?: string }> {
  const resp = await apiFetch(`/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  return resp.ok ? {} : { error: await readError(resp) };
}

/** Скачивает полную выгрузку персональных данных пользователя файлом (см. GET
 *  /admin/users/:id/export в server.js) — то, что администратор пересылает пользователю в ответ
 *  на его запрос о своих данных. */
export async function exportAdminUserData(id: string): Promise<{ error?: string }> {
  const resp = await apiFetch(`/admin/users/${id}/export`);
  if (!resp.ok) return { error: await readError(resp) };
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `user-${id}-export.json`;
  a.click();
  URL.revokeObjectURL(url);
  return {};
}

export async function anonymizeAdminUser(id: string): Promise<{ error?: string }> {
  const resp = await apiFetch(`/admin/users/${id}/anonymize`, { method: "POST" });
  return resp.ok ? {} : { error: await readError(resp) };
}

export async function deleteAdminUser(id: string): Promise<{ error?: string }> {
  const resp = await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
  return resp.ok ? {} : { error: await readError(resp) };
}
