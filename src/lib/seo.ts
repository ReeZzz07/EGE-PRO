// Настройки SEO (заголовки/описания публичных страниц + картинка для соцсетей) — та же таблица
// content_blocks, что и остальной контент лендинга (публичное чтение, редактирует только админ),
// новый ключ "seo". Читает и применяет их src/lib/useDocumentHead.ts на каждой публичной странице.
import { supabase, isSupabaseConfigured } from "./supabase";

// Домен ещё не куплен — плейсхолдер. Задаётся сборке через VITE_SITE_URL (.env), используется
// здесь (canonical/og:url), а public/robots.txt и public/sitemap.xml — статические файлы, Vite их
// не обрабатывает, так что при появлении реального домена их придётся поправить вручную отдельно.
export const SITE_URL_PLACEHOLDER = "https://ege-pro.ru";
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || SITE_URL_PLACEHOLDER;

export type SeoPageKey = "home" | "tariffs" | "offer" | "privacy";

export interface SeoPageMeta {
  title: string;
  description: string;
}

export interface SeoSettings {
  /** абсолютный URL картинки для превью в соцсетях/мессенджерах (og:image) — необязательно */
  ogImage: string;
  pages: Record<SeoPageKey, SeoPageMeta>;
}

export const SEO_PAGE_LABELS: Record<SeoPageKey, string> = {
  home: "Главная / лендинг",
  tariffs: "Тарифы",
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
};

export const DEFAULT_SEO: SeoSettings = {
  ogImage: "",
  pages: {
    home: {
      title: "ЕГЭ·ПРО — тренажёр с ИИ-репетитором",
      description:
        "ЕГЭ·ПРО — тренажёр для подготовки к ЕГЭ с ИИ-репетитором. Задания из Открытого банка ФИПИ: математика, русский язык, информатика, физика, обществознание и другие предметы.",
    },
    tariffs: {
      title: "Тарифы — ЕГЭ·ПРО",
      description: "Бесплатный и платные тарифы подготовки к ЕГЭ с ИИ-репетитором: банк заданий ФИПИ, персональный план, проверка сочинений по критериям.",
    },
    offer: {
      title: "Публичная оферта — ЕГЭ·ПРО",
      description: "Публичная оферта на использование образовательной онлайн-платформы «ЕГЭ·ПРО».",
    },
    privacy: {
      title: "Политика конфиденциальности — ЕГЭ·ПРО",
      description: "Политика обработки персональных данных пользователей платформы «ЕГЭ·ПРО».",
    },
  },
};

export async function loadSeoSettings(): Promise<SeoSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_SEO;
  const { data, error } = await supabase.from("content_blocks").select("data").eq("key", "seo").maybeSingle();
  if (error || !data?.data) return DEFAULT_SEO;
  const saved = data.data as Partial<SeoSettings>;
  return {
    ogImage: saved.ogImage ?? DEFAULT_SEO.ogImage,
    pages: {
      home: { ...DEFAULT_SEO.pages.home, ...saved.pages?.home },
      tariffs: { ...DEFAULT_SEO.pages.tariffs, ...saved.pages?.tariffs },
      offer: { ...DEFAULT_SEO.pages.offer, ...saved.pages?.offer },
      privacy: { ...DEFAULT_SEO.pages.privacy, ...saved.pages?.privacy },
    },
  };
}

export async function saveSeoSettings(data: SeoSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key: "seo", data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
