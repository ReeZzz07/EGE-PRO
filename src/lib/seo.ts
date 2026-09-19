// Настройки SEO (заголовки/описания публичных страниц + картинка для соцсетей) — та же таблица
// content_blocks, что и остальной контент лендинга (публичное чтение, редактирует только админ),
// новый ключ "seo". Читает и применяет их src/lib/useDocumentHead.ts.
//
// Только Главная и Тарифы — реально маркетинговые страницы, ради которых есть смысл подбирать
// заголовок/описание под поисковую выдачу. Оферта и политика конфиденциальности (см. lib/legal.ts,
// LEGAL_SEO) на такой трафик не рассчитаны — на них попадают по ссылке из футера/при регистрации,
// а не из поиска, поэтому у них фиксированные заголовки без формы в админке и noindex.
import { supabase, isSupabaseConfigured } from "./supabase";
import { parseMetrikaId } from "./metrika";

const MAX_OG_IMAGE_BYTES = 5 * 1024 * 1024;
const OG_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Грузит картинку для og:image в отдельный бакет сториджа ("seo", см. docker/api/server.js
 * KNOWN_BUCKETS) — тот же путь, что у admin-загрузки медиа к заданиям (adminTasks.ts), только
 * бакет свой. Имя файла с таймстампом, а не фиксированное "og-image.png" — иначе повторная
 * загрузка отдавала бы старую картинку из годового кэша браузера/CDN (см. cache-control на
 * GET /storage/:bucket/* в server.js), пока URL не изменится. */
export async function uploadOgImage(file: File): Promise<{ url?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  if (!OG_IMAGE_TYPES.includes(file.type)) return { error: "Поддерживаются только PNG, JPEG, GIF и WEBP." };
  if (file.size > MAX_OG_IMAGE_BYTES) return { error: "Файл слишком большой — до 5 МБ." };

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const path = `og-image-${Date.now()}${ext}`;
  const { data, error } = await supabase.storage.from("seo").upload(path, file, { contentType: file.type, upsert: true });
  if (error) return { error: (error as { message?: string; error?: string }).message ?? (error as { error?: string }).error ?? "Не удалось загрузить файл" };
  // data.path может отличаться от path выше — server.js подменяет расширение на реальное по
  // магическим байтам файла, если имя на диске пользователя не совпадает с настоящим форматом
  // (см. комментарий в docker/api/server.js, correctedPathForActualContent) — строим URL по нему,
  // иначе картинка сохранится под одним именем, а og:image будет указывать на другое (404).
  return { url: supabase.storage.from("seo").getPublicUrl(data?.path ?? path).data.publicUrl };
}

// Домен ещё не куплен — плейсхолдер. Задаётся сборке через VITE_SITE_URL (.env), используется
// здесь (canonical/og:url) и как основа дефолтного текста robots.txt/sitemap.xml ниже.
export const SITE_URL_PLACEHOLDER = "https://ege-pro.ru";
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || SITE_URL_PLACEHOLDER;

export type SeoPageKey = "home" | "tariffs";

export interface SeoPageMeta {
  title: string;
  description: string;
}

export interface SeoSettings {
  /** абсолютный URL картинки для превью в соцсетях/мессенджерах (og:image) — необязательно */
  ogImage: string;
  /** номер счётчика Яндекс.Метрики (только цифры, см. lib/metrika.ts); пустая строка — счётчик выключен */
  metrikaId: string;
  pages: Record<SeoPageKey, SeoPageMeta>;
}

export const SEO_PAGE_LABELS: Record<SeoPageKey, string> = {
  home: "Главная / лендинг",
  tariffs: "Тарифы",
};

export const DEFAULT_SEO: SeoSettings = {
  ogImage: "",
  metrikaId: "",
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
  },
};

export async function loadSeoSettings(): Promise<SeoSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_SEO;
  const { data, error } = await supabase.from("content_blocks").select("data").eq("key", "seo").maybeSingle();
  if (error || !data?.data) return DEFAULT_SEO;
  const saved = data.data as Partial<SeoSettings>;
  return {
    ogImage: saved.ogImage ?? DEFAULT_SEO.ogImage,
    // Значение из БД подставляется на страницу как номер счётчика — всё, что не похоже на номер
    // (испорченные данные), отбрасываем, а не доверяем на слово.
    metrikaId: typeof saved.metrikaId === "string" ? (parseMetrikaId(saved.metrikaId) ?? "") : DEFAULT_SEO.metrikaId,
    pages: {
      home: { ...DEFAULT_SEO.pages.home, ...saved.pages?.home },
      tariffs: { ...DEFAULT_SEO.pages.tariffs, ...saved.pages?.tariffs },
    },
  };
}

export async function saveSeoSettings(data: SeoSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key: "seo", data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}

// ─────────────────────── robots.txt ───────────────────────
// Раньше это был статический файл в public/ — при смене домена его приходилось редактировать в
// репозитории и передеплоивать (см. историю коммитов). Теперь текст хранится в public.app_settings
// (RLS — только админ, как и остальные ключи там, см. 0008_app_settings.sql) и отдаётся живьём на
// каждый запрос GET /robots.txt (docker/api/server.js) — правка в админке применяется сразу, без
// пересборки фронтенда. sitemap.xml, в отличие от robots.txt, — не редактируется вообще: у
// приложения всего 2 страницы, ради которых есть смысл в поисковой выдаче (см. SEO_PAGE_LABELS
// выше), так что docker/api/server.js собирает его сам из домена и этого же списка страниц — реже
// расходится с реальностью, чем текст, который можно забыть обновить руками.
export interface SeoFiles {
  robotsTxt: string;
}

/** Тот же дефолт, что использует docker/api/server.js, если в app_settings ещё ничего не сохранено —
 * здесь нужен только для того, чтобы форма в админке при первом открытии показывала осмысленный
 * текст (с настоящим доменом сборки), а не пустую textarea. */
export function defaultSeoFiles(): SeoFiles {
  return { robotsTxt: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n` };
}

export async function loadSeoFiles(): Promise<SeoFiles> {
  const def = defaultSeoFiles();
  if (!isSupabaseConfigured || !supabase) return def;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "robots_txt").maybeSingle();
  if (error || !data) return def;
  const text = (data.value as { text?: string })?.text;
  return { robotsTxt: text || def.robotsTxt };
}

export async function saveSeoFiles(files: SeoFiles, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "robots_txt", value: { text: files.robotsTxt }, updated_by: userId });
  return error ? { error: error.message } : {};
}
