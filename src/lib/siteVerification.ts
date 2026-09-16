// Коды подтверждения владения доменом для Яндекс.Вебмастера и Google Search Console —
// public.app_settings, ключ 'site_verification'. Хранится сам код (то, что стоит в атрибуте
// content нужного вебмастеру/консоли meta-тега), а не готовая разметка — так его нельзя случайно
// испортить лишним символом, а сервер сам собирает из него правильный тег (см.
// docker/api/server.js, resolveSiteVerificationMetaTags).
//
// Применяется только к HTML, который видят боты/краулеры (см. docker/api/server.js, роут
// GET / и /tariffs — тот же, что уже отдаёт актуальные og-теги ботам соцсетей, см. историю
// коммитов про og:image) — то есть немедленно, без пересборки. Реальным браузерам страницу
// отдаёт статически собранный index.html (Vite, во время сборки), его эти теги не трогают — для
// них правка = менять index.html и пересобирать/передеплоивать.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface SiteVerificationSettings {
  yandex: string;
  google: string;
}

export const DEFAULT_SITE_VERIFICATION: SiteVerificationSettings = { yandex: "", google: "" };

export async function loadSiteVerification(): Promise<SiteVerificationSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_SITE_VERIFICATION;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "site_verification").maybeSingle();
  if (error || !data) return DEFAULT_SITE_VERIFICATION;
  const v = data.value as Partial<SiteVerificationSettings>;
  return { yandex: v.yandex ?? "", google: v.google ?? "" };
}

export async function saveSiteVerification(settings: SiteVerificationSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "site_verification", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}
