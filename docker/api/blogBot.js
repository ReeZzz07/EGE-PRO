// Страницы /blog и /blog/<статья> для краулеров и нейросетей. Сайт — SPA: у людей статья рисуется JavaScript'ом, а
// нейросети (GPTBot, PerplexityBot, ClaudeBot, Яндекс и др.) JS не исполняют и видели бы пустую оболочку. Caddy
// отправляет ботов (по User-Agent) сюда, и они получают обычный HTML с текстом статьи, заголовками, внутренними
// ссылками и разметкой JSON-LD (Article, BreadcrumbList). Людей это не касается: они по-прежнему идут в SPA.
//
// Отдаём только то, что видит гость: статья опубликована И visible_to_guests (то же правило, что RLS-политика для
// анонимов и sitemap.xml). Черновик и «только для зарегистрированных» для бота — 404.
import { pool } from "./db.js";
import { escapeHtml } from "./botHtml.js";

const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "u", "s", "code", "pre", "hr", "br", "a"]);
const VOID_TAGS = new Set(["br", "hr"]);
const BACKSLASH = String.fromCharCode(92);

/** Допустимая ссылка из атрибутов тега <a>: http(s), mailto, tel, относительные и якоря. Остальное (javascript:, data:) — null. */
function safeHref(attrs) {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  if (!m) return null;
  const value = (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim();
  // скрытые пробелы и управляющие символы внутри схемы («java\\nscript:») не должны обходить проверку
  const probe = value.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (!/^(https?:|mailto:|tel:|\/|#)/.test(probe)) return null;
  return value;
}

/** Серверная очистка HTML статьи: тот же набор тегов, что у фронтенда (src/lib/blog.ts sanitizeArticleHtml), без
 *  атрибутов, кроме href у ссылок. Всё остальное вырезается, а оставшиеся «<» и «>» в тексте экранируются. */
export function sanitizeArticleHtml(html) {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  const text = (t) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    out += text(s.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    if (tag === "a") {
      const href = safeHref(m[3]);
      out += href ? `<a href="${escapeHtml(href)}" rel="noopener">` : "<a>";
      continue;
    }
    out += `<${tag}>`;
  }
  out += text(s.slice(last));
  return out;
}

const siteName = "ЕГЭ·ПРО";
const NAV = `<header><nav><a href="/">${siteName}</a> <a href="/tariffs">Тарифы</a> <a href="/blog">База знаний</a> <a href="/parents">Родителям</a> <a href="/contacts">Контакты</a></nav></header>`;
const FOOTER = `<footer><p>${siteName} — учебный проект: тренажёр для подготовки к ЕГЭ с ИИ-репетитором. Задания взяты из открытого банка ФИПИ; сервис не является официальным ресурсом ФИПИ или Рособрнадзора.</p></footer>`;

/** JSON-LD внутри <script>: «<» экранируем, чтобы строка вроде «</script>» в заголовке не закрыла тег. */
function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, `${BACKSLASH}u003c`)}</script>`;
}

const absolute = (siteUrl, url) => (!url ? "" : /^https?:\/\//i.test(url) ? url : url.startsWith("/") && siteUrl ? `${siteUrl}${url}` : "");
const iso = (v) => (v ? new Date(v).toISOString() : null);
const dateRu = (v) => new Date(v).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
const trimText = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function head({ title, description, canonicalUrl, ogImage, ogType = "website", verificationMetaTags = "", noindex = false, extra = "" }) {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow"}">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${verificationMetaTags}
${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ""}
<meta property="og:site_name" content="${siteName}">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="ru_RU">
${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${extra}
</head><body>
`;
}

/** Страница статьи для бота. article: { slug, title, excerpt, content, cover_image, published_at, updated_at }; related — другие статьи. */
export function renderBlogArticlePage({ article, related = [], siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/blog/${article.slug}` : "";
  const description = trimText(article.excerpt || article.content.replace(/<[^>]+>/g, " "), 300) || "Статьи и разборы для подготовки к ЕГЭ.";
  const cover = absolute(siteUrl, article.cover_image);
  const published = iso(article.published_at);
  const modified = iso(article.updated_at) ?? published;
  const org = { "@type": "Organization", name: siteName, ...(siteUrl ? { url: siteUrl } : {}) };
  const ldArticle = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: trimText(article.title, 110),
    description,
    inLanguage: "ru",
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    ...(cover ? { image: [cover] } : {}),
    ...(canonicalUrl ? { mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl } } : {}),
    author: org,
    publisher: org,
  };
  const ldCrumbs = siteUrl
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Главная", item: `${siteUrl}/` },
          { "@type": "ListItem", position: 2, name: "База знаний", item: `${siteUrl}/blog` },
          { "@type": "ListItem", position: 3, name: article.title, item: canonicalUrl },
        ],
      }
    : null;
  const relatedHtml = related.length
    ? `<section><h2>Читайте также</h2><ul>${related.map((r) => `<li><a href="/blog/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a></li>`).join("")}</ul></section>\n`
    : "";
  return (
    head({
      title: article.title,
      description,
      canonicalUrl,
      ogImage: cover,
      ogType: "article",
      verificationMetaTags,
      extra: `${published ? `<meta property="article:published_time" content="${published}">` : ""}\n${modified ? `<meta property="article:modified_time" content="${modified}">` : ""}\n${jsonLd(ldArticle)}${ldCrumbs ? `\n${jsonLd(ldCrumbs)}` : ""}`,
    }) +
    `${NAV}
<main>
<nav aria-label="Навигация по разделам"><a href="/">Главная</a> / <a href="/blog">База знаний</a></nav>
<article>
<h1>${escapeHtml(article.title)}</h1>
${published ? `<p><time datetime="${published}">${escapeHtml(dateRu(article.published_at))}</time></p>\n` : ""}${article.excerpt ? `<p><em>${escapeHtml(article.excerpt)}</em></p>\n` : ""}${sanitizeArticleHtml(article.content)}
</article>
<p><a href="/">Пройти бесплатную диагностику на ${siteName}</a></p>
${relatedHtml}</main>
${FOOTER}
</body></html>
`
  );
}

/** Список статей /blog для бота. */
export function renderBlogIndexPage({ articles, siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/blog` : "";
  const title = "База знаний — ЕГЭ·ПРО";
  const description = "Статьи и разборы для подготовки к ЕГЭ: сравнения, гайды, объяснения — как эффективно готовиться и пользоваться платформой.";
  const ld = siteUrl
    ? {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        inLanguage: "ru",
        url: canonicalUrl,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: articles.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: `${siteUrl}/blog/${a.slug}`, name: a.title })),
        },
      }
    : null;
  const items = articles
    .map(
      (a) =>
        `<li><h2><a href="/blog/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></h2>${a.published_at ? ` <time datetime="${iso(a.published_at)}">${escapeHtml(dateRu(a.published_at))}</time>` : ""}${a.excerpt ? `<p>${escapeHtml(a.excerpt)}</p>` : ""}</li>`
    )
    .join("\n");
  return (
    head({ title, description, canonicalUrl, verificationMetaTags, extra: ld ? jsonLd(ld) : "" }) +
    `${NAV}
<main>
<h1>База знаний</h1>
<p>${escapeHtml(description)}</p>
${articles.length ? `<ul>\n${items}\n</ul>` : "<p>Статьи скоро появятся.</p>"}
</main>
${FOOTER}
</body></html>
`
  );
}

export function renderBlogNotFound() {
  return head({ title: "Статья не найдена — ЕГЭ·ПРО", description: "Такой статьи нет или она больше не опубликована.", noindex: true }) + `${NAV}\n<main><h1>Статья не найдена</h1><p><a href="/blog">Все статьи базы знаний</a></p></main>\n</body></html>\n`;
}

const GUEST_VISIBLE = "is_published = true and visible_to_guests = true";
const ORDER = "is_pinned desc, published_at desc nulls last";

export async function getBlogIndex(opts = {}) {
  const { rows } = await pool.query(`select slug, title, excerpt, published_at from public.blog_articles where ${GUEST_VISIBLE} order by ${ORDER}`);
  return renderBlogIndexPage({ articles: rows, ...opts });
}

/** { status, html }: 200 со страницей или 404 — для черновика, закрытой для гостей и несуществующей статьи. */
export async function getBlogArticle(slug, opts = {}) {
  const s = String(slug ?? "");
  if (!s || s.length > 200) return { status: 404, html: renderBlogNotFound() };
  const { rows } = await pool.query(`select slug, title, excerpt, content, cover_image, published_at, updated_at from public.blog_articles where slug = $1 and ${GUEST_VISIBLE}`, [s]);
  if (!rows[0]) return { status: 404, html: renderBlogNotFound() };
  const related = (await pool.query(`select slug, title from public.blog_articles where ${GUEST_VISIBLE} and slug <> $1 order by ${ORDER} limit 5`, [s])).rows;
  return { status: 200, html: renderBlogArticlePage({ article: rows[0], related, ...opts }) };
}
