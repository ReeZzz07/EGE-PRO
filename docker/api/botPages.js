// Страницы / , /tariffs , /parents , /contacts , /oferta , /privacy для краулеров и нейросетей. Сайт — SPA: людям эти страницы рисует
// JavaScript, а нейросети (GPTBot, PerplexityBot, ClaudeBot и др.) его не исполняют и видели бы пустую оболочку или короткую заглушку.
// Caddy отправляет ботов (по User-Agent) сюда: они получают обычный HTML с настоящим содержимым страницы, внутренними ссылками
// и разметкой JSON-LD. Людей это не касается: они по-прежнему идут в SPA. Статьи блога — в blogBot.js.
//
// Тексты не дублируем: статичные берём из общих JSON docker/api/content/*.json (те же файлы импортирует фронтенд), редактируемые
// в админке — из БД (content_blocks, tariffs, legal_documents), как и сам сайт.
import fs from "node:fs";
import { pool } from "./db.js";
import { escapeHtml } from "./botHtml.js";
import { siteName, NAV, FOOTER, jsonLd, dateRu, head } from "./botLayout.js";
import { SUBJECT_NAMES } from "./subjectNames.js";
import { getPublicContactInfo } from "./feedback.js";
import { listPublicReviews } from "./reviews.js";

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`./content/${name}`, import.meta.url), "utf8"));
const LANDING = readJson("landing.json");
const TARIFFS_PAGE = readJson("tariffsPage.json");
const PARENTS = readJson("parents.json");
const CONTACTS = readJson("contacts.json");

/** Заголовки и описания по умолчанию — те же, что в админке «SEO» (src/lib/seo.ts), если там ничего не сохранено. */
export const DEFAULT_PAGE_SEO = {
  home: {
    title: "ЕГЭ·ПРО — тренажёр с ИИ-репетитором",
    description:
      "ЕГЭ·ПРО — тренажёр для подготовки к ЕГЭ с ИИ-репетитором. Задания из Открытого банка ФИПИ: математика, русский язык, физика, обществознание, биология, химия и другие предметы.",
  },
  tariffs: {
    title: "Тарифы — ЕГЭ·ПРО",
    description: "Бесплатный и платные тарифы подготовки к ЕГЭ с ИИ-репетитором: банк заданий ФИПИ, персональный план, проверка сочинений по критериям.",
  },
};

// Заголовки секций лендинга — в Landing.tsx они написаны прямо в разметке; тест botPages.test.js сверяет, что они не разошлись.
export const LANDING_HEADINGS = {
  subjects: "С какого предмета начнём?",
  process: "Четыре шага от диагностики до пробника",
  capabilities: "Не решебник, а нормальная подготовка",
  faq: "Коротко о главном",
  cta: "Пройди диагностику и получи план подготовки",
};

const rubles = (n) => `${Math.round(Number(n)).toLocaleString("ru-RU")} ₽`;
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const esc = escapeHtml;

/** «Платёж»: токен {price} в строке таблицы родителей → «От X за 30 дней, » (есть платные тарифы) или «Фиксированная цена за 30 дней, ». */
export function parentsUsText(us, minPrice) {
  return us.replace("{price}", minPrice ? PARENTS.priceFrom.replace("{p}", minPrice) : PARENTS.priceFlat);
}

// ─────────────────────── данные из БД ───────────────────────

async function contentBlock(key) {
  const { rows } = await pool.query("select data from public.content_blocks where key = $1", [key]);
  return rows[0]?.data ?? null;
}

export async function loadSeo() {
  const saved = await contentBlock("seo").catch(() => null);
  return {
    ogImage: saved?.ogImage || "",
    pages: {
      home: { ...DEFAULT_PAGE_SEO.home, ...(saved?.pages?.home ?? {}) },
      tariffs: { ...DEFAULT_PAGE_SEO.tariffs, ...(saved?.pages?.tariffs ?? {}) },
    },
  };
}

async function loadLanding() {
  const out = {};
  for (const key of ["hero", "capabilities", "process", "faq"]) {
    const saved = await contentBlock(key).catch(() => null);
    out[key] = saved ?? LANDING[key];
  }
  return out;
}

async function loadTariffs() {
  const { rows } = await pool.query(
    `select id, name, badge, price_rub, sale_price_rub, subjects_count, daily_ai_limit, features
       from public.tariffs where is_active order by sort_order, price_rub`
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    badge: t.badge,
    price: Number(t.sale_price_rub ?? t.price_rub),
    basePrice: Number(t.price_rub),
    subjectsCount: t.subjects_count,
    dailyAiLimit: t.daily_ai_limit,
    features: Array.isArray(t.features) ? t.features.filter((f) => typeof f === "string") : [],
  }));
}

async function loadSubjects() {
  const { rows } = await pool.query("select subject, count(*)::int as n from public.tasks where published = true group by subject");
  const counts = new Map(rows.map((r) => [r.subject, r.n]));
  return Object.keys(SUBJECT_NAMES)
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .map((id) => ({ id, name: SUBJECT_NAMES[id], total: counts.get(id) }));
}

// ─────────────────────── общие куски разметки ───────────────────────

const org = (siteUrl, ogImage) => ({ "@type": "Organization", name: siteName, ...(siteUrl ? { url: siteUrl } : {}), ...(ogImage ? { logo: ogImage } : {}) });

function faqLd(items) {
  return items.length
    ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }
    : null;
}

const crumbsLd = (siteUrl, trail) =>
  siteUrl
    ? { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${siteUrl}${path}` })) }
    : null;

const ld = (...objs) => objs.filter(Boolean).map(jsonLd).join("\n");

function tariffLine(t) {
  const price = t.price === 0 ? "бесплатно" : rubles(t.price);
  const subjects = `${t.subjectsCount} ${plural(t.subjectsCount, "предмет", "предмета", "предметов")}`;
  const ai = t.dailyAiLimit != null ? `до ${t.dailyAiLimit} обращений к ИИ-репетитору в день` : "безлимитный ИИ-репетитор";
  return { price, subjects, ai };
}

const page = (meta, bodyHtml) => head(meta) + `${NAV}\n<main>\n${bodyHtml}\n</main>\n${FOOTER}\n</body></html>\n`;

// ─────────────────────── главная ───────────────────────

export function renderHomePage({ seo, landing, subjects, tariffs, reviews, contactEmail, siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/` : "";
  const total = subjects.reduce((n, s) => n + s.total, 0);
  const subjectsHtml = subjects.length
    ? `<section>\n<h2>${esc(LANDING_HEADINGS.subjects)}</h2>\n<p>В банке ${total.toLocaleString("ru-RU")} ${plural(total, "задание", "задания", "заданий")} из открытого банка ФИПИ по ${subjects.length} ${plural(subjects.length, "предмету", "предметам", "предметам")}.</p>\n<ul>\n${subjects
        .map((s) => `<li>${esc(s.name)}: ${s.total.toLocaleString("ru-RU")} ${plural(s.total, "задание", "задания", "заданий")}</li>`)
        .join("\n")}\n</ul>\n</section>`
    : "";
  const processHtml = landing.process.length
    ? `<section>\n<h2>${esc(LANDING_HEADINGS.process)}</h2>\n<ol>\n${landing.process.map((s) => `<li><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`).join("\n")}\n</ol>\n</section>`
    : "";
  const capsHtml = landing.capabilities.length
    ? `<section>\n<h2>${esc(LANDING_HEADINGS.capabilities)}</h2>\n<ul>\n${landing.capabilities.map((c) => `<li><h3>${esc(c.t)}</h3><p>${esc(c.d)}</p></li>`).join("\n")}\n</ul>\n</section>`
    : "";
  const tariffsHtml = tariffs.length
    ? `<section>\n<h2>Тарифы</h2>\n<ul>\n${tariffs
        .map((t) => {
          const l = tariffLine(t);
          return `<li><strong>${esc(t.name)}</strong>: ${esc(l.price)}${t.price > 0 ? " за 30 дней" : ""}, ${esc(l.subjects)}, ${esc(l.ai)}</li>`;
        })
        .join("\n")}\n</ul>\n<p><a href="/tariffs">Все тарифы и условия оплаты</a></p>\n</section>`
    : "";
  const reviewsHtml = reviews.length
    ? `<section>\n<h2>Отзывы учеников</h2>\n${reviews.map((r) => `<blockquote><p>${esc(r.body)}</p><footer>${esc(r.displayName || "Ученик")}${r.subject && SUBJECT_NAMES[r.subject] ? `, ${esc(SUBJECT_NAMES[r.subject])}` : ""}, оценка ${esc(r.rating)} из 5</footer></blockquote>`).join("\n")}\n</section>`
    : "";
  const faqHtml = landing.faq.length
    ? `<section>\n<h2>${esc(LANDING_HEADINGS.faq)}</h2>\n${landing.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}\n</section>`
    : "";
  const body = `<h1>${esc(landing.hero.title)}</h1>
<p>${esc(landing.hero.subtitle)}</p>
<p><a href="/parents">Для родителей: чем это отличается от репетитора</a> · <a href="/blog">База знаний: статьи и разборы</a></p>
${[subjectsHtml, processHtml, capsHtml, tariffsHtml, reviewsHtml, faqHtml].filter(Boolean).join("\n")}
<section>
<h2>${esc(LANDING_HEADINGS.cta)}</h2>
<p>Зарегистрируйтесь на ${siteName}, пройдите диагностику за 7–10 минут и получите персональный план. Вопросы — на странице <a href="/contacts">контактов</a>.</p>
</section>`;
  const orgLd = { "@context": "https://schema.org", ...org(siteUrl, ""), description: seo.pages.home.description, ...(contactEmail ? { contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: contactEmail, availableLanguage: "ru" } } : {}) };
  const siteLd = siteUrl ? { "@context": "https://schema.org", "@type": "WebSite", name: siteName, url: siteUrl, inLanguage: "ru" } : null;
  return page({ title: seo.pages.home.title, description: seo.pages.home.description, canonicalUrl, ogImage: seo.ogImage, verificationMetaTags, extra: ld(orgLd, siteLd, faqLd(landing.faq)) }, body);
}

// ─────────────────────── тарифы ───────────────────────

export function renderTariffsPage({ seo, content, tariffs, siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/tariffs` : "";
  const anyPaid = tariffs.some((t) => t.price > 0);
  const items = tariffs
    .map((t) => {
      const l = tariffLine(t);
      const old = t.basePrice > t.price ? ` (вместо ${rubles(t.basePrice)})` : "";
      return `<article>
<h2>${esc(t.name)}</h2>
<p><strong>${esc(l.price)}</strong>${t.price > 0 ? " за 30 дней" : ""}${esc(old)}</p>
<ul>
<li>${esc(l.subjects)} на выбор</li>
<li>${esc(l.ai)}</li>
${t.features.map((f) => `<li>${esc(f)}</li>`).join("\n")}
</ul>
</article>`;
    })
    .join("\n");
  const body = `<h1>${esc(content.title)}</h1>
<p>${esc(content.subtitle)}</p>
${items}
${anyPaid && content.perSubjectNote ? `<p>${esc(content.perSubjectNote)}</p>` : ""}
<p>${esc(content.paymentNote)}</p>
<p>Условия: <a href="/oferta">публичная оферта</a>, <a href="/privacy">политика конфиденциальности</a>. Для родителей: <a href="/parents">как оплатить за ребёнка</a>.</p>`;
  const list = tariffs.length
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: content.title,
        itemListElement: tariffs.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Service",
            name: t.name,
            serviceType: "Подготовка к ЕГЭ",
            provider: org(siteUrl, ""),
            offers: { "@type": "Offer", price: t.price.toFixed(2), priceCurrency: "RUB", availability: "https://schema.org/InStock", ...(canonicalUrl ? { url: canonicalUrl } : {}) },
          },
        })),
      }
    : null;
  return page({ title: seo.pages.tariffs.title, description: seo.pages.tariffs.description, canonicalUrl, ogImage: seo.ogImage, verificationMetaTags, extra: ld(list, crumbsLd(siteUrl, [["Главная", "/"], ["Тарифы", "/tariffs"]])) }, body);
}

// ─────────────────────── родителям ───────────────────────

export function renderParentsPage({ seo, tariffs, siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/parents` : "";
  const paid = tariffs.filter((t) => t.price > 0);
  const minPrice = paid.length ? rubles(Math.min(...paid.map((t) => t.price))) : "";
  const vsRows = PARENTS.vs.map((v) => `<tr><th scope="row">${esc(v.row)}</th><td>${esc(v.tutor)}</td><td>${esc(parentsUsText(v.us, minPrice))}</td></tr>`).join("\n");
  const tariffsHtml = paid.length
    ? `<section>\n<h2>${esc(PARENTS.tariffsTitle)}</h2>\n<p>${esc(PARENTS.tariffsIntro)}</p>\n<ul>\n${paid.map((t) => `<li><strong>${esc(t.name)}</strong>: ${esc(rubles(t.price))}, на 30 дней, ${t.subjectsCount} ${plural(t.subjectsCount, "предмет", "предмета", "предметов")}</li>`).join("\n")}\n</ul>\n<p>${esc(PARENTS.tariffsNote)}</p>\n</section>`
    : "";
  const body = `<h1>${esc(PARENTS.h1)}</h1>
<p>${esc(PARENTS.intro)}</p>
<section>
<h2>${esc(PARENTS.vsTitle)}</h2>
<p>${esc(PARENTS.vsIntro)}</p>
<table>
<thead><tr><th scope="col"></th><th scope="col">${esc(PARENTS.vsHeaders[1])}</th><th scope="col">${esc(PARENTS.vsHeaders[2])}</th></tr></thead>
<tbody>
${vsRows}
</tbody>
</table>
</section>
<section>
<h2>${esc(PARENTS.stepsTitle)}</h2>
<ol>
${PARENTS.steps.map((s) => `<li><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`).join("\n")}
</ol>
</section>
${tariffsHtml}
<section>
<h2>${esc(PARENTS.payTitle)}</h2>
<ol>
${PARENTS.pay.map((t) => `<li>${esc(t)}</li>`).join("\n")}
</ol>
</section>
<section>
<ul>
${PARENTS.trust.map((x) => `<li><strong>${esc(x.t)}</strong>: ${esc(x.d)}</li>`).join("\n")}
</ul>
</section>
<section>
<h2>${esc(PARENTS.faqTitle)}</h2>
${PARENTS.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}
</section>
<p>Остались вопросы? <a href="/contacts">Напишите нам</a>, ответим в течение одного дня. Подробнее: <a href="/oferta">публичная оферта</a>, <a href="/privacy">политика конфиденциальности</a>.</p>`;
  return page(
    { title: PARENTS.seo.title, description: PARENTS.seo.description, canonicalUrl, ogImage: seo.ogImage, verificationMetaTags, extra: ld(faqLd(PARENTS.faq), crumbsLd(siteUrl, [["Главная", "/"], ["Родителям", "/parents"]])) },
    body
  );
}

// ─────────────────────── контакты ───────────────────────

export function renderContactsPage({ seo, info, legal, siteUrl = "", verificationMetaTags = "" }) {
  const canonicalUrl = siteUrl ? `${siteUrl}/contacts` : "";
  const reply = info.replyWithinHours === 24 ? "в течение одного дня" : `в течение ${info.replyWithinHours} часов`;
  const requisites = legal && (legal.inn || legal.ogrnip) ? `<section>\n<h2>Реквизиты</h2>\n<p>${legal.inn ? `ИНН ${esc(legal.inn)}` : ""}${legal.inn && legal.ogrnip ? "<br>" : ""}${legal.ogrnip ? `ОГРНИП ${esc(legal.ogrnip)}` : ""}</p>\n</section>` : "";
  const channels = info.channels.length ? `<ul>\n${info.channels.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.label)}</a></li>`).join("\n")}\n</ul>` : "";
  const body = `<h1>${esc(CONTACTS.h1)}</h1>
<p>${esc(CONTACTS.intro.replace("{reply}", reply))}</p>
<section>
<h2>Почта поддержки</h2>
<p><a href="mailto:${esc(info.supportEmail)}">${esc(info.supportEmail)}</a></p>
<p>Отвечаем ${esc(reply)}.</p>
${channels}
</section>
<section>
<h2>Быстрые ответы</h2>
<ul>
<li><a href="/oferta">Условия оплаты: в оферте</a></li>
<li><a href="/privacy">Как мы работаем с данными: политика конфиденциальности</a></li>
<li><a href="/parents">Как оплатить за ребёнка: для родителей</a></li>
</ul>
</section>
${requisites}`;
  const contactLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: CONTACTS.seo.title,
    ...(canonicalUrl ? { url: canonicalUrl } : {}),
    mainEntity: { ...org(siteUrl, ""), contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: info.supportEmail, availableLanguage: "ru" } },
  };
  return page({ title: CONTACTS.seo.title, description: CONTACTS.seo.description, canonicalUrl, ogImage: seo.ogImage, verificationMetaTags, extra: ld(contactLd, crumbsLd(siteUrl, [["Главная", "/"], ["Контакты", "/contacts"]])) }, body);
}

// ─────────────────────── оферта и политика ───────────────────────

const LEGAL_PATHS = { "/oferta": "offer", "/privacy": "privacy" };
const LEGAL_SEO = {
  offer: { title: "Публичная оферта — ЕГЭ·ПРО", description: "Публичная оферта на использование образовательного сервиса ЕГЭ·ПРО." },
  privacy: { title: "Политика конфиденциальности — ЕГЭ·ПРО", description: "Политика обработки персональных данных пользователей ЕГЭ·ПРО." },
};

/** Текст документа как в SPA (там white-space: pre-wrap): абзацы по пустой строке, одиночные переносы — <br>. */
export function legalTextToHtml(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function renderLegalPage({ key, doc, seo, siteUrl = "", verificationMetaTags = "" }) {
  const path = key === "offer" ? "/oferta" : "/privacy";
  const canonicalUrl = siteUrl ? `${siteUrl}${path}` : "";
  const body = `<h1>${esc(doc.title)}</h1>\n${doc.updated_at ? `<p>Редакция от ${esc(dateRu(doc.updated_at))}</p>\n` : ""}${legalTextToHtml(doc.content)}`;
  // как и в SPA (LegalDoc.tsx): не для поисковой выдачи, но ссылки обходить можно
  return page({ ...LEGAL_SEO[key], canonicalUrl, ogImage: seo.ogImage, verificationMetaTags, noindex: true }, body);
}

// ─────────────────────── точка входа ───────────────────────

export const BOT_PAGE_PATHS = ["/", "/tariffs", "/parents", "/contacts", "/oferta", "/privacy"];

/** { status, html } для пути из BOT_PAGE_PATHS; null — путь не наш. Любая ошибка БД всплывает вызывающему (server.js отдаёт заглушку). */
export async function getBotPage(pathname, { siteUrl = "", verificationMetaTags = "" } = {}) {
  const opts = { siteUrl, verificationMetaTags };
  if (!BOT_PAGE_PATHS.includes(pathname)) return null;
  const seo = await loadSeo();
  if (pathname === "/") {
    const [landing, subjects, tariffs, reviews, info] = await Promise.all([
      loadLanding(),
      loadSubjects().catch(() => []),
      loadTariffs().catch(() => []),
      listPublicReviews(6).then((r) => r.reviews).catch(() => []),
      getPublicContactInfo().catch(() => null),
    ]);
    return { status: 200, html: renderHomePage({ seo, landing, subjects, tariffs, reviews, contactEmail: info?.supportEmail ?? "", ...opts }) };
  }
  if (pathname === "/tariffs") {
    const saved = await contentBlock("tariffsPage").catch(() => null);
    const tariffs = await loadTariffs();
    return { status: 200, html: renderTariffsPage({ seo, content: { ...TARIFFS_PAGE, ...(saved ?? {}) }, tariffs, ...opts }) };
  }
  if (pathname === "/parents") {
    const tariffs = await loadTariffs().catch(() => []);
    return { status: 200, html: renderParentsPage({ seo, tariffs, ...opts }) };
  }
  if (pathname === "/contacts") {
    const [info, legal] = await Promise.all([getPublicContactInfo(), contentBlock("legalEntity").catch(() => null)]);
    return { status: 200, html: renderContactsPage({ seo, info, legal, ...opts }) };
  }
  const key = LEGAL_PATHS[pathname];
  const { rows } = await pool.query("select title, content, updated_at from public.legal_documents where key = $1", [key]);
  if (!rows[0]) return { status: 404, html: renderLegalPage({ key, doc: { title: LEGAL_SEO[key].title, content: "Документ пока недоступен.", updated_at: null }, seo, ...opts }) };
  return { status: 200, html: renderLegalPage({ key, doc: rows[0], seo, ...opts }) };
}
