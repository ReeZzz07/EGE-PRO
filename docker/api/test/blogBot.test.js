// Страницы блога для краулеров и нейросетей (docker/api/blogBot.js): чистка HTML, разметка и что видит бот (против локального Postgres).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sanitizeArticleHtml, renderBlogArticlePage, renderBlogIndexPage, getBlogArticle, getBlogIndex } from "../blogBot.js";
import { pool } from "./helpers.js";

const tag = `bot${randomUUID().slice(0, 8)}`;
const ids = [];

after(async () => {
  for (const id of ids) await pool.query("delete from public.blog_articles where id = $1", [id]);
  await pool.end();
});

async function article({ published = true, guests = true, title, content = "<p>Текст статьи</p>", excerpt = "Анонс" } = {}) {
  const slug = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `insert into public.blog_articles (slug, title, excerpt, content, is_published, visible_to_guests, published_at) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [slug, title ?? `Статья ${slug}`, excerpt, content, published, guests, published ? new Date() : null]
  );
  ids.push(rows[0].id);
  return slug;
}

test("sanitizeArticleHtml: форматирование остаётся, скрипты, стили, обработчики и опасные ссылки вырезаются", () => {
  const html = '<h2>Заголовок</h2><p>Текст <strong>важно</strong> и <em>акцент</em></p><ul><li>раз</li></ul><script>alert(1)</script><style>p{}</style><img src=x onerror="alert(2)"><iframe src="//evil"></iframe>';
  const clean = sanitizeArticleHtml(html);
  assert.equal(clean, "<h2>Заголовок</h2><p>Текст <strong>важно</strong> и <em>акцент</em></p><ul><li>раз</li></ul>");
  assert.doesNotMatch(clean, /script|onerror|iframe|style/i);
});

test("sanitizeArticleHtml: у ссылок остаётся только безопасный href; javascript:, data: и «спрятанные» схемы отбрасываются", () => {
  assert.equal(sanitizeArticleHtml('<a href="https://ege-tutor.ru/blog" onclick="x()">ссылка</a>'), '<a href="https://ege-tutor.ru/blog" rel="noopener">ссылка</a>');
  assert.equal(sanitizeArticleHtml('<a href="/tariffs">тарифы</a>'), '<a href="/tariffs" rel="noopener">тарифы</a>');
  assert.equal(sanitizeArticleHtml('<a href="https://x.ru/?a=1&amp;b=2">q</a>'), '<a href="https://x.ru/?a=1&amp;b=2" rel="noopener">q</a>');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAA', ' java' + String.fromCharCode(10) + 'script:alert(1)', 'vbscript:x']) {
    const clean = sanitizeArticleHtml(`<a href="${bad}">x</a>`);
    assert.equal(clean, "<a>x</a>", bad);
  }
});

test("sanitizeArticleHtml: недозакрытые и странные конструкции не пропускают разметку; пусто и null — пустая строка", () => {
  assert.doesNotMatch(sanitizeArticleHtml("<p>до</p><img src=x onerror=alert(1)"), /<img/);
  assert.ok(!sanitizeArticleHtml("a <b onmouseover=x>b</b> c").includes("onmouseover"));
  assert.equal(sanitizeArticleHtml("<!-- скрыто --><p>ок</p>"), "<p>ок</p>");
  assert.equal(sanitizeArticleHtml(""), "");
  assert.equal(sanitizeArticleHtml(null), "");
});

test("renderBlogArticlePage: заголовок, текст, дата, canonical, JSON-LD Article и BreadcrumbList; «</script>» в заголовке разметку не ломает", () => {
  const html = renderBlogArticlePage({
    article: { slug: "kak-gotovitsya", title: 'Как готовиться </script><b>x', excerpt: "Анонс статьи", content: "<h2>Раздел</h2><p>Содержимое</p>", cover_image: "/storage/blog/c.jpg", published_at: "2026-09-27T09:00:00Z", updated_at: "2026-10-01T09:00:00Z" },
    related: [{ slug: "drugaya", title: "Другая статья" }],
    siteUrl: "https://ege-tutor.ru",
  });
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/blog\/kak-gotovitsya">/);
  assert.match(html, /<h1>Как готовиться &lt;\/script&gt;&lt;b&gt;x<\/h1>/);
  assert.match(html, /<h2>Раздел<\/h2><p>Содержимое<\/p>/);
  assert.match(html, /<time datetime="2026-09-27T09:00:00\.000Z">27 сентября 2026 г\.<\/time>/);
  assert.match(html, /<a href="\/blog\/drugaya">Другая статья<\/a>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/ege-tutor\.ru\/storage\/blog\/c\.jpg">/);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 2, "два блока JSON-LD разбираются как JSON");
  const art = blocks.find((b) => b["@type"] === "Article");
  assert.equal(art.headline, 'Как готовиться </script><b>x');
  assert.equal(art.datePublished, "2026-09-27T09:00:00.000Z");
  assert.equal(art.dateModified, "2026-10-01T09:00:00.000Z");
  assert.equal(art.mainEntityOfPage["@id"], "https://ege-tutor.ru/blog/kak-gotovitsya");
  assert.equal(art.author.name, "ЕГЭ·ПРО");
  const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
  assert.deepEqual(crumbs.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(html.split("</script><b>").length, 1, "сырой </script> из заголовка нигде не попал в разметку");
});

test("renderBlogArticlePage: без домена нет canonical, JSON-LD страницы-цепочки и абсолютных ссылок; без анонса описание берётся из текста", () => {
  const html = renderBlogArticlePage({ article: { slug: "a", title: "Т", excerpt: "", content: "<p>Первый абзац статьи про ЕГЭ</p>", cover_image: null, published_at: null, updated_at: null }, siteUrl: "" });
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /BreadcrumbList/);
  assert.match(html, /<meta name="description" content="Первый абзац статьи про ЕГЭ">/);
  assert.doesNotMatch(html, /http:\/\//);
});

test("renderBlogIndexPage: список статей ссылками с анонсами, JSON-LD ItemList; пустой список — не пустая страница", () => {
  const html = renderBlogIndexPage({ articles: [{ slug: "a", title: "Первая", excerpt: "Анонс 1", published_at: "2026-09-27T09:00:00Z" }, { slug: "b", title: "Вторая", excerpt: "", published_at: null }], siteUrl: "https://ege-tutor.ru" });
  assert.match(html, /<h1>База знаний<\/h1>/);
  assert.match(html, /<h2><a href="\/blog\/a">Первая<\/a><\/h2>/);
  assert.match(html, /<p>Анонс 1<\/p>/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld.mainEntity.itemListElement.length, 2);
  assert.equal(ld.mainEntity.itemListElement[0].url, "https://ege-tutor.ru/blog/a");
  assert.match(renderBlogIndexPage({ articles: [], siteUrl: "" }), /Статьи скоро появятся/);
});

test("getBlogArticle: бот видит опубликованную статью, а черновик, закрытую для гостей и несуществующую — 404 с noindex", async () => {
  const open = await article({ title: "Открытая статья", content: "<p>Видимый <strong>текст</strong></p><script>x()</script>" });
  const draft = await article({ published: false });
  const members = await article({ guests: false });

  const ok = await getBlogArticle(open, { siteUrl: "https://ege-tutor.ru" });
  assert.equal(ok.status, 200);
  assert.match(ok.html, /<h1>Открытая статья<\/h1>/);
  assert.match(ok.html, /Видимый <strong>текст<\/strong>/);
  assert.doesNotMatch(ok.html, /x\(\)/);

  for (const slug of [draft, members, "net-takoi-stati", "", "x".repeat(300)]) {
    const r = await getBlogArticle(slug, { siteUrl: "https://ege-tutor.ru" });
    assert.equal(r.status, 404, slug.slice(0, 30));
    assert.match(r.html, /noindex/);
    assert.doesNotMatch(r.html, /Текст статьи/);
  }
});

test("getBlogArticle / getBlogIndex: в «Читайте также» и в списке нет самой статьи, черновиков и закрытых для гостей", async () => {
  const a = await article({ title: "Статья А" });
  const b = await article({ title: "Статья Б" });
  const draft = await article({ published: false, title: "Черновик Ц" });
  const members = await article({ guests: false, title: "Закрытая Д" });
  const r = await getBlogArticle(a, { siteUrl: "" });
  assert.match(r.html, new RegExp(`<a href="/blog/${b}">Статья Б</a>`));
  assert.doesNotMatch(r.html, new RegExp(`<a href="/blog/${a}">Статья А</a></li>`));
  assert.doesNotMatch(r.html, new RegExp(draft));
  assert.doesNotMatch(r.html, new RegExp(members));
  const index = await getBlogIndex({ siteUrl: "" });
  assert.match(index, new RegExp(`/blog/${a}`));
  assert.doesNotMatch(index, new RegExp(draft));
  assert.doesNotMatch(index, new RegExp(members));
});
