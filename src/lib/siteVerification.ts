// Произвольные <meta>-теги для подтверждения владения доменом (Яндекс.Вебмастер, Google Search
// Console и т.п.) — public.app_settings, ключ 'site_verification'. В отличие от большинства
// настроек в этом файле, значение — СЫРОЙ HTML (сама разметка тега), не текст: админ вставляет
// готовый тег из панели вебмастера как есть, экранировать его не нужно и нельзя — это и есть тег.
//
// Применяется только к HTML, который видят боты/краулеры (см. docker/api/server.js, роут
// GET / и /tariffs — тот же, что уже отдаёт актуальные og-теги ботам соцсетей, см. историю
// коммитов про og:image) — то есть немедленно, без пересборки. Реальным браузерам страницу
// отдаёт статически собранный index.html (Vite, во время сборки), его этот тег не трогает — для
// него правка тега = менять index.html и пересобирать/передеплоивать.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface SiteVerificationSettings {
  metaTags: string;
}

export const DEFAULT_SITE_VERIFICATION: SiteVerificationSettings = { metaTags: "" };

export async function loadSiteVerification(): Promise<SiteVerificationSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_SITE_VERIFICATION;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "site_verification").maybeSingle();
  if (error || !data) return DEFAULT_SITE_VERIFICATION;
  const v = data.value as Partial<SiteVerificationSettings>;
  return { metaTags: v.metaTags ?? "" };
}

export async function saveSiteVerification(settings: SiteVerificationSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "site_verification", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}
