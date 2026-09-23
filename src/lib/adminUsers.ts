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
  discount_percent: number | null;
  anonymized_at: string | null;
  tariff_name: string | null;
  tariff_price_rub: number | null;
  tariff_active: boolean;
  subjects: AdminUserSubject[];
}

export interface AdminUserPatch {
  fullName?: string;
  email?: string;
  tariffId?: string;
  tariffExpiresAt?: string | null;
  discountPercent?: number | null;
  isAdmin?: boolean;
}

export async function searchAdminUsers(q: string, page: number, pageSize: number): Promise<{ rows: AdminUserListItem[]; total: number }> {
  if (!isSupabaseConfigured) return { rows: [], total: 0 };
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q.trim()) params.set("q", q.trim());
  const resp = await apiFetch(`/admin/users?${params}`);
  if (!resp.ok) return { rows: [], total: 0 };
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
