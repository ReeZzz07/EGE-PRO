// База знаний / блог — public.blog_articles (supabase/migrations/0032_blog_articles.sql). Публичное
// чтение только опубликованных статей доступно всем (в т.ч. гостям) — фильтр по is_published задаёт
// сама RLS-политика, а не запрос здесь (см. миграцию), так что черновик не прочитать даже зная slug.
// Запись — только администраторам. Тот же прямой Supabase-shim паттерн, что и tariffs.ts.
import { useEffect, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import { supabase, isSupabaseConfigured } from "./supabase";

export interface BlogArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  isPublished: boolean;
  isPinned: boolean;
  /** false — статья видна только зарегистрированным (любым, не только платным); гостям RLS её не
   *  отдаёт вовсе, см. supabase/migrations/0033_blog_visibility.sql. По умолчанию true. */
  visibleToGuests: boolean;
  /** мс от эпохи, как profile.tariffExpiresAt — null, пока статья ни разу не публиковалась. */
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type BlogArticleInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  isPinned: boolean;
  visibleToGuests: boolean;
};

const RU_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** URL-адрес статьи из заголовка: транслитерация кириллицы в латиницу + kebab-case. Чистая функция —
 *  используется и в AdminBlog.tsx для авто-подстановки, и в тестах. */
export function slugify(title: string): string {
  const translit = title
    .toLowerCase()
    .split("")
    .map((ch) => RU_TO_LATIN[ch] ?? ch)
    .join("");
  return translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Разрешённые теги/атрибуты — ровно то, что реально может произвести RichTextEditor.tsx (StarterKit +
// Link + Underline): текстовое форматирование, заголовки 2-3 уровня, списки, цитата, ссылка, разрыв
// строки/абзаца. Раздел "content" пишет только админ (см. AdminBlog.tsx), но dangerouslySetInnerHTML
// на публичной странице (BlogArticle.tsx) всё равно санитизируем — админ-аккаунт может быть скомпрометирован
// или получить вставленный откуда-то извне HTML, доверять содержимому поля вслепую нельзя.
export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "u", "s", "code", "pre", "hr", "br", "a"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}

function fromRow(row: Record<string, unknown>): BlogArticle {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    excerpt: row.excerpt as string,
    content: row.content as string,
    coverImage: (row.cover_image as string | null) ?? null,
    isPublished: row.is_published as boolean,
    isPinned: row.is_pinned as boolean,
    visibleToGuests: row.visible_to_guests as boolean,
    publishedAt: row.published_at ? new Date(row.published_at as string).getTime() : null,
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
}

const PUBLISHED_ORDER = { pinned: { ascending: false } as const, published: { ascending: false } as const };

/** Опубликованные статьи, закреплённые первыми — для публичного списка /blog. */
export async function loadPublishedArticles(): Promise<BlogArticle[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("blog_articles")
    .select("*")
    .eq("is_published", true)
    .order("is_pinned", PUBLISHED_ORDER.pinned)
    .order("published_at", PUBLISHED_ORDER.published);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow);
}

/** Статья по slug — для /blog/:slug. RLS сама прячет черновики от не-админа (см. миграцию), доп.
 *  фильтр по is_published здесь не нужен — если строка вернулась, её можно показывать. */
export async function loadArticleBySlug(slug: string): Promise<BlogArticle | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.from("blog_articles").select("*").eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return fromRow(data as Record<string, unknown>);
}

/** Для раздела «последние статьи» на лендинге и дашборде — закреплённые первыми, дальше по свежести. */
export async function loadHomepageArticles(limit = 4): Promise<BlogArticle[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("blog_articles")
    .select("*")
    .eq("is_published", true)
    .order("is_pinned", PUBLISHED_ORDER.pinned)
    .order("published_at", PUBLISHED_ORDER.published)
    .limit(limit);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow);
}

/** Все статьи, включая черновики — для админки. */
export async function loadAllArticlesAdmin(): Promise<BlogArticle[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.from("blog_articles").select("*").order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow);
}

function friendlyWriteError(message: string): string {
  if (/duplicate key value violates unique constraint/.test(message)) return "Такой URL (slug) уже используется — выбери другой.";
  return message;
}

export async function createArticle(input: BlogArticleInput, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("blog_articles").insert({
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    content: input.content,
    cover_image: input.coverImage,
    is_pinned: input.isPinned,
    visible_to_guests: input.visibleToGuests,
    created_by: userId,
  });
  return error ? { error: friendlyWriteError(error.message) } : {};
}

export async function updateArticle(id: string, patch: Partial<BlogArticleInput>): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.slug !== undefined) row.slug = patch.slug;
  if (patch.excerpt !== undefined) row.excerpt = patch.excerpt;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.coverImage !== undefined) row.cover_image = patch.coverImage;
  if (patch.isPinned !== undefined) row.is_pinned = patch.isPinned;
  if (patch.visibleToGuests !== undefined) row.visible_to_guests = patch.visibleToGuests;
  const { error } = await supabase.from("blog_articles").update(row).eq("id", id);
  return error ? { error: friendlyWriteError(error.message) } : {};
}

/** currentPublishedAt — publishedAt статьи ДО вызова: published_at ставится в now() только если
 *  статья ещё ни разу не публиковалась, иначе дата первой публикации не съезжает при переиздании. */
export async function publishArticle(id: string, currentPublishedAt: number | null): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const row: Record<string, unknown> = { is_published: true };
  if (currentPublishedAt === null) row.published_at = new Date().toISOString();
  const { error } = await supabase.from("blog_articles").update(row).eq("id", id);
  return error ? { error: error.message } : {};
}

export async function unpublishArticle(id: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("blog_articles").update({ is_published: false }).eq("id", id);
  return error ? { error: error.message } : {};
}

export async function deleteArticle(id: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("blog_articles").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;
const COVER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Обложка статьи — свой бакет "blog" (см. docker/api/server.js KNOWN_BUCKETS), тот же приём, что и
 *  uploadOgImage в lib/seo.ts: имя файла с таймстампом (не фиксированное — иначе повторная загрузка
 *  отдавала бы старую картинку из кэша), URL строится из ВОЗВРАЩЁННОГО пути (сервер может поправить
 *  расширение на реальное по магическим байтам файла). */
export async function uploadBlogCoverImage(file: File): Promise<{ url?: string; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  if (!COVER_IMAGE_TYPES.includes(file.type)) return { error: "Поддерживаются только PNG, JPEG, GIF и WEBP." };
  if (file.size > MAX_COVER_IMAGE_BYTES) return { error: "Файл слишком большой — до 5 МБ." };

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const path = `article-${Date.now()}${ext}`;
  const { data, error } = await supabase.storage.from("blog").upload(path, file, { contentType: file.type, upsert: true });
  if (error) return { error: (error as { message?: string; error?: string }).message ?? (error as { error?: string }).error ?? "Не удалось загрузить файл" };
  return { url: supabase.storage.from("blog").getPublicUrl(data?.path ?? path).data.publicUrl };
}

// ─────────────────────── счётчик новых статей (пункт меню "База знаний") ───────────────────────
// Отметка прочтения — своя таблица (public.blog_article_reads, supabase/migrations/0034), а не
// один общий "последний визит": именно поэтому счётчик уменьшается по одной статье за раз, а не
// обнуляется целиком при заходе в раздел — так и просил пользователь. Только для авторизованных,
// гостям функции здесь не вызываются вовсе (см. Header.tsx/BlogArticle.tsx).
let blogReadsVersion = 0;
const blogReadsListeners = new Set<() => void>();
function bumpBlogReadsVersion() {
  blogReadsVersion++;
  for (const l of blogReadsListeners) l();
}
function subscribeBlogReads(l: () => void) {
  blogReadsListeners.add(l);
  return () => blogReadsListeners.delete(l);
}
function getBlogReadsVersion() {
  return blogReadsVersion;
}
/** Форсирует пересчёт useUnreadBlogCount во всех смонтированных компонентах (Header.tsx) сразу
 *  после markArticleRead — без этого счётчик обновился бы только при следующем их ремонте. */
function useBlogReadsVersion(): number {
  return useSyncExternalStore(subscribeBlogReads, getBlogReadsVersion, getBlogReadsVersion);
}

/** Отмечает статью прочитанной текущим пользователем — вызывается из BlogArticle.tsx при успешной
 *  загрузке статьи залогиненным пользователем. Повторная отметка той же статьи — не ошибка
 *  (primary key (user_id, article_id) в таблице), просто игнорируется. */
export async function markArticleRead(articleId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  await supabase.from("blog_article_reads").insert({ user_id: userId, article_id: articleId });
  bumpBlogReadsVersion();
}

/** Сколько опубликованных статей пользователь ещё не открывал — null, пока не гость и не загрузилось
 *  (Header.tsx не показывает бейдж вовсе в обоих случаях, разница ему не важна). */
export function useUnreadBlogCount(userId: string | undefined): number | null {
  const version = useBlogReadsVersion();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured || !supabase) {
      setCount(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      supabase.from("blog_articles").select("id").eq("is_published", true),
      supabase.from("blog_article_reads").select("article_id").eq("user_id", userId),
    ]).then(([articlesRes, readsRes]) => {
      if (cancelled) return;
      const readIds = new Set((readsRes.data ?? []).map((r: { article_id: string }) => r.article_id));
      const unread = (articlesRes.data ?? []).filter((a: { id: string }) => !readIds.has(a.id)).length;
      setCount(unread);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  return count;
}
