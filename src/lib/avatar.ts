// Аватар профиля хранится в profiles.avatar_url одним из двух видов:
// - "preset:<id>" — готовый вариант, чисто клиентский рендер цветной иконкой (см. AVATAR_PRESETS
//   ниже), файла на диске нет;
// - "avatars/<userId>.<ext>" — путь к загруженной фотографии в сторидже (см. docker/api/server.js
//   POST/DELETE /profile/avatar), отдаётся публично через /storage/avatars/...
// null/undefined — аватар не выбран, используется инициал имени (см. ProfileView.tsx).
import { apiFetch, isSupabaseConfigured, url as apiBaseUrl } from "./supabase";

export interface AvatarPreset {
  id: string;
  icon: string;
  bg: string;
}

/** Своя иконка + фирменный цвет из палитры (см. src/index.css @theme) — без внешних картинок,
 *  в том же графическом языке, что и остальной интерфейс. */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "blue", icon: "star", bg: "bg-blue" },
  { id: "red", icon: "flame", bg: "bg-red" },
  { id: "green", icon: "target", bg: "bg-green" },
  { id: "amber", icon: "bulb", bg: "bg-amber" },
  { id: "violet", icon: "sigma", bg: "bg-violet" },
  { id: "rose", icon: "spark", bg: "bg-rose" },
  { id: "teal", icon: "book", bg: "bg-teal" },
  { id: "indigo", icon: "chart", bg: "bg-indigo" },
];

export function presetFromAvatarUrl(avatarUrl: string | undefined): AvatarPreset | null {
  if (!avatarUrl?.startsWith("preset:")) return null;
  const id = avatarUrl.slice("preset:".length);
  return AVATAR_PRESETS.find((p) => p.id === id) ?? null;
}

/** Публичный URL для загруженной фотографии (avatarUrl вида "avatars/..."), null для preset:/пусто. */
export function photoUrlFromAvatarUrl(avatarUrl: string | undefined): string | null {
  if (!avatarUrl || avatarUrl.startsWith("preset:")) return null;
  return `${apiBaseUrl}/storage/${avatarUrl}`;
}

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export async function uploadAvatar(file: File): Promise<{ path?: string; error?: string }> {
  if (!isSupabaseConfigured) return { error: "Загрузка своей фотографии недоступна в демо-режиме — выбери готовый вариант." };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: "Поддерживаются только PNG, JPEG, GIF и WEBP." };
  if (file.size > MAX_AVATAR_BYTES) return { error: "Файл слишком большой — до 4 МБ." };

  const form = new FormData();
  form.append("file", file);
  const resp = await apiFetch("/profile/avatar", { method: "POST", body: form });
  const json = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
  if (!resp.ok) return { error: json.error?.message ?? resp.statusText };
  return { path: json.path };
}

export async function removeUploadedAvatar(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return {};
  const resp = await apiFetch("/profile/avatar", { method: "DELETE" });
  if (!resp.ok) {
    const json = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    return { error: json.error?.message ?? resp.statusText };
  }
  return {};
}
