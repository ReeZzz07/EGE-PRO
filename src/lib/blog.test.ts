// slugify — единственная реально новая чистая логика в blog.ts (транслитерация кириллицы), легко
// ошибиться. CRUD-обёртки вокруг supabase.from() здесь не тестируем отдельно — как и в tariffs.ts,
// исключение — маппинг ошибки конфликта slug на понятный текст (friendlyWriteError).
import { describe, expect, it, vi } from "vitest";
import { createArticle, sanitizeArticleHtml, slugify } from "./blog";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}));

describe("slugify", () => {
  it("транслитерирует кириллицу в латиницу и делает kebab-case", () => {
    expect(slugify("ИИ-репетитор vs живой репетитор")).toBe("ii-repetitor-vs-zhivoi-repetitor");
  });

  it("смешанный текст с цифрами и двоеточием", () => {
    expect(slugify("ЕГЭ 2027: топ-5 советов")).toBe("ege-2027-top-5-sovetov");
  });

  it("ъ и ь пропадают, не оставляя пустых дефисов", () => {
    expect(slugify("подъезд")).toBe("podezd");
  });

  it("не даёт начальных/конечных/двойных дефисов при пробелах и пунктуации по краям", () => {
    expect(slugify("  Привет,  мир!!  ")).toBe("privet-mir");
  });

  it("строка без букв/цифр — пустая строка, не исключение", () => {
    expect(slugify("...")).toBe("");
  });
});

describe("sanitizeArticleHtml", () => {
  it("вырезает script и обработчики on* — XSS через content не проходит", () => {
    const dirty = '<p>Текст</p><script>alert(1)</script><p onclick="alert(2)">клик</p>';
    const clean = sanitizeArticleHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain("Текст");
    expect(clean).toContain("клик");
  });

  it("пропускает реальный набор тегов редактора (заголовки, списки, цитата, ссылка, форматирование)", () => {
    const html = '<h2>Заголовок</h2><p><strong>жирный</strong> <em>курсив</em> <u>подчёркнутый</u></p><ul><li>пункт</li></ul><blockquote>цитата</blockquote><p><a href="https://ege-tutor.ru">ссылка</a></p>';
    expect(sanitizeArticleHtml(html)).toBe(html);
  });

  it("вырезает недопустимые атрибуты у ссылки (например, javascript: или обработчик), но саму ссылку оставляет", () => {
    const dirty = '<p><a href="https://x.ru" onmouseover="alert(1)">x</a></p>';
    const clean = sanitizeArticleHtml(dirty);
    expect(clean).toBe('<p><a href="https://x.ru">x</a></p>');
  });
});

describe("createArticle", () => {
  it("конфликт уникальности slug — понятная русская ошибка, а не сырое сообщение Postgres", async () => {
    vi.mocked(supabase!.from).mockReturnValue({
      insert: () => Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "blog_articles_slug_key"' } }),
    } as never);
    const res = await createArticle({ title: "t", slug: "dup", excerpt: "e", content: "c", coverImage: null, isPinned: false, visibleToGuests: true }, "user-1");
    expect(res.error).toBe("Такой URL (slug) уже используется — выбери другой.");
  });

  it("прочая ошибка — проходит как есть", async () => {
    vi.mocked(supabase!.from).mockReturnValue({
      insert: () => Promise.resolve({ error: { message: "connection refused" } }),
    } as never);
    const res = await createArticle({ title: "t", slug: "s", excerpt: "e", content: "c", coverImage: null, isPinned: false, visibleToGuests: true }, "user-1");
    expect(res.error).toBe("connection refused");
  });
});
