// Страницы /blog и /blog/<статья> для краулеров и нейросетей. Сайт — SPA: у людей статья рисуется JavaScript'ом, а
// нейросети (GPTBot, PerplexityBot, ClaudeBot, Яндекс и др.) JS не исполняют и видели бы пустую оболочку. Caddy
// отправляет ботов (по User-Agent) сюда, и они получают обычный HTML с текстом статьи, заголовками, внутренними
// ссылками и разметкой JSON-LD (Article, BreadcrumbList). Людей это не касается: они по-прежнему идут в SPA.
//
// Отдаём только то, что видит гость: статья опубликована И visible_to_guests (то же правило, что RLS-политика для
// анонимов и sitemap.xml). Черновик и «только для зарегистрированных» для бота — 404.
import { pool } from "./db.js";
import { escapeHtml } from "./botHtml.js";
import { siteName, NAV, FOOTER, jsonLd, absolute, iso, dateRu, trimText, head } from "./botLayout.js";

const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "u", "s", "code", "pre", "hr", "br", "a"]);
const VOID_TAGS = new Set(["br", "hr"]);

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
  // <title>/og:title — до ~60 символов (выдача); H1 оставляем полным
  const metaTitle = trimText(article.title, 60);
  const articleFaq = [
    { q: `О чём статья «${trimText(article.title, 80)}»?`, a: description },
    { q: "С чего начать подготовку на ЕГЭ·ПРО?", a: "Пройдите бесплатную диагностику 7–10 минут: уровень, слабые темы и персональный план. ИИ-репетитор наводит на решение, а не сдаёт экзамен за вас." },
    { q: "Это официальный ресурс ФИПИ?", a: "Нет. ЕГЭ·ПРО — учебный проект: задания в формате открытого банка ФИПИ, сервис не является официальным ресурсом ФИПИ или Рособрнадзора." },
  ];
  const ldFaq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: articleFaq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    head({
      title: metaTitle,
      description,
      canonicalUrl,
      ogImage: cover,
      ogType: "article",
      verificationMetaTags,
      extra: `${published ? `<meta property="article:published_time" content="${published}">` : ""}\n${modified ? `<meta property="article:modified_time" content="${modified}">` : ""}\n${jsonLd(ldArticle)}${ldCrumbs ? `\n${jsonLd(ldCrumbs)}` : ""}\n${jsonLd(ldFaq)}`,
    }) +
    `${NAV}
<main>
<nav aria-label="Навигация по разделам"><a href="/">Главная</a> / <a href="/blog">База знаний</a></nav>
<article>
<h1>${escapeHtml(article.title)}</h1>
${published ? `<p><time datetime="${published}">${escapeHtml(dateRu(article.published_at))}</time></p>\n` : ""}${article.excerpt ? `<p><em>${escapeHtml(article.excerpt)}</em></p>\n` : ""}${sanitizeArticleHtml(article.content)}
</article>
<section>
<h2>Коротко</h2>
${articleFaq.map((f) => `<h3>${escapeHtml(f.q)}</h3>\n<p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>
<p><a href="/diagnostic">Пройти бесплатную диагностику на ${siteName}</a> · <a href="/contacts">Контакты</a></p>
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
  const faq = [
    { q: "Что публикуется в базе знаний ЕГЭ·ПРО?", a: "Разборы предметов, гайды по диагностике и плану, сравнения форматов подготовки и статьи для родителей — без гарантий балла." },
    { q: "С чего начать, если читаю блог впервые?", a: "Пройдите бесплатную диагностику на платформе (7–10 минут) и откройте статьи по своим слабым темам." },
    { q: "Можно ли готовиться только по статьям?", a: "Статьи помогают сориентироваться; основной тренинг — задания в тренажёре и разбор с ИИ-репетитором, который наводит на решение." },
  ];
  const ldFaq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    head({ title, description, canonicalUrl, verificationMetaTags, extra: `${ld ? `${jsonLd(ld)}\n` : ""}${jsonLd(ldFaq)}` }) +
    `${NAV}
<main>
<h1>База знаний</h1>
<p>${escapeHtml(description)}</p>
<section>
<h2>Факты</h2>
<ul>
<li>Онлайн-тренажёр ЕГЭ с ИИ-репетитором (наводит на решение, не сдаёт экзамен за ученика)</li>
<li>Бесплатная диагностика 7–10 минут → уровень и план</li>
<li>Учебный проект: не официальный ресурс ФИПИ</li>
</ul>
</section>
${articles.length ? `<ul>\n${items}\n</ul>` : "<p>Статьи скоро появятся.</p>"}
<section>
<h2>Частые вопросы</h2>
${faq.map((f) => `<h3>${escapeHtml(f.q)}</h3>\n<p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>
<p><a href="/diagnostic">Пройти диагностику</a> · <a href="/contacts">Написать нам</a></p>
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
