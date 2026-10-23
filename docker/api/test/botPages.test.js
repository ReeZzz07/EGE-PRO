// Страницы для краулеров и нейросетей: /, /tariffs, /parents, /contacts, /oferta, /privacy (docker/api/botPages.js).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOT_PAGE_PATHS,
  LANDING_HEADINGS,
  getBotPage,
  legalTextToHtml,
  parentsUsText,
  renderContactsPage,
  renderHomePage,
  renderLegalPage,
  renderParentsPage,
  renderTariffsPage,
} from "../botPages.js";
import { pool } from "./helpers.js";

after(() => pool.end());

const SITE = "https://ege-tutor.ru";
const seo = { ogImage: "https://ege-tutor.ru/storage/seo/og.jpg", pages: { home: { title: "ЕГЭ·ПРО — тренажёр", description: "Описание главной" }, tariffs: { title: "Тарифы — ЕГЭ·ПРО", description: "Описание тарифов" } } };
const tariffs = [
  { id: "free", name: "Попробовать", badge: "Бесплатно", price: 0, basePrice: 0, subjectsCount: 2, dailyAiLimit: 3, features: ["Диагностика, план, пробные варианты"] },
  { id: "attestat", name: "АТТЕСТАТ", badge: null, price: 1990, basePrice: 1990, subjectsCount: 2, dailyAiLimit: null, features: ["2 предмета на выбор"] },
  { id: "vuz", name: "ВУЗ", badge: null, price: 2793, basePrice: 3990, subjectsCount: 4, dailyAiLimit: null, features: [] },
];
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const body = (html) => html.slice(html.indexOf("<body>"));

test("renderHomePage: заголовок и подзаголовок героя, предметы со счётчиками, шаги, возможности, тарифы, вопросы; JSON-LD Organization, WebSite, FAQPage", () => {
  const html = renderHomePage({
    seo,
    landing: {
      hero: { title: "Подготовка к ЕГЭ с ИИ-репетитором", subtitle: "Диагностика, план и разборы." },
      capabilities: [{ icon: "target", t: "Диагностика уровня", d: "8–12 заданий." }],
      process: [{ n: "01", icon: "target", t: "Диагностика", d: "7–10 минут." }],
      faq: [{ q: "Это официальный ресурс ФИПИ?", a: "Нет, учебный проект." }],
    },
    subjects: [{ id: "math", name: "Математика (профиль)", total: 4774 }, { id: "rus", name: "Русский язык", total: 7370 }],
    tariffs,
    reviews: [{ body: "Помогло разобраться", displayName: "Аня", rating: 5, subject: "math" }],
    contactEmail: "support@ege-tutor.ru",
    siteUrl: SITE,
  });
  assert.match(html, /<h1>Подготовка к ЕГЭ с ИИ-репетитором<\/h1>/);
  assert.match(html, /<p>Диагностика, план и разборы\.<\/p>/);
  assert.match(html, /<li>Математика \(профиль\): 4\s774 задания<\/li>/);
  assert.match(html, /<li>Русский язык: 7\s370 заданий<\/li>/);
  assert.match(html, /В банке 12\s144 задания из открытого банка ФИПИ по 2 предметам\./);
  assert.match(html, new RegExp(LANDING_HEADINGS.subjects));
  assert.match(html, /<h3>Диагностика<\/h3><p>7–10 минут\.<\/p>/);
  assert.match(html, /<h3>Диагностика уровня<\/h3>/);
  assert.match(html, /<strong>АТТЕСТАТ<\/strong>: 1\s990 ₽ за 30 дней, 2 предмета, безлимитный ИИ-репетитор/);
  assert.match(html, /<strong>Попробовать<\/strong>: бесплатно, 2 предмета, до 3 обращений к ИИ-репетитору в день/);
  assert.match(html, /<blockquote><p>Помогло разобраться<\/p><footer>Аня, Математика \(профиль\), оценка 5 из 5<\/footer><\/blockquote>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/ege-tutor\.ru\/storage\/seo\/og\.jpg">/);
  const types = ldBlocks(html).map((b) => b["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite", "FAQPage"]);
  const faq = ldBlocks(html).find((b) => b["@type"] === "FAQPage");
  assert.equal(faq.mainEntity[0].name, "Это официальный ресурс ФИПИ?");
  assert.equal(ldBlocks(html)[0].contactPoint.email, "support@ege-tutor.ru");
});

test("renderHomePage: пустые секции не рисуются, отзывов нет — нет блока отзывов; HTML из текстов экранируется", () => {
  const html = renderHomePage({
    seo,
    landing: { hero: { title: 'Заголовок <script>alert(1)</script>', subtitle: 'Текст "в кавычках" & амперсанд' }, capabilities: [], process: [], faq: [] },
    subjects: [],
    tariffs: [],
    reviews: [],
    siteUrl: "",
  });
  assert.doesNotMatch(body(html), /<script>alert/);
  assert.match(html, /<h1>Заголовок &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.doesNotMatch(html, /Отзывы учеников|<h2>Тарифы<\/h2>|Коротко о главном/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.equal(ldBlocks(html).filter((b) => b["@type"] === "FAQPage").length, 0, "без вопросов нет FAQPage");
});

test("renderTariffsPage: заголовок и тексты из админки, карточки тарифов с ценой и лимитом, Service+Offer с ценой со скидкой", () => {
  const html = renderTariffsPage({
    seo,
    content: { eyebrow: "тарифы", title: "Выбери, сколько предметов готовить", subtitle: "Диагностика, план и ИИ-репетитор.", perSubjectNote: "при поштучной покупке — от 1290 ₽/мес за предмет", paymentNote: "Разовая оплата на 30 дней, без автосписаний." },
    tariffs,
    siteUrl: SITE,
  });
  assert.match(html, /<h1>Выбери, сколько предметов готовить<\/h1>/);
  assert.match(html, /<h2>ВУЗ<\/h2>\s*<p><strong>2\s793 ₽<\/strong> за 30 дней \(вместо 3\s990 ₽\)<\/p>/);
  assert.match(html, /<li>до 3 обращений к ИИ-репетитору в день<\/li>/);
  assert.match(html, /при поштучной покупке/);
  assert.match(html, /Разовая оплата на 30 дней, без автосписаний\./);
  const list = ldBlocks(html).find((b) => b["@type"] === "ItemList");
  assert.equal(list.itemListElement.length, 3);
  const vuz = list.itemListElement[2].item;
  assert.equal(vuz.offers.price, "2793.00");
  assert.equal(vuz.offers.priceCurrency, "RUB");
  assert.equal(list.itemListElement[0].item.offers.price, "0.00");
  assert.ok(ldBlocks(html).some((b) => b["@type"] === "BreadcrumbList"));
});

test("renderTariffsPage: без платных тарифов заметка про цену за предмет не показывается", () => {
  const html = renderTariffsPage({ seo, content: { title: "Т", subtitle: "С", perSubjectNote: "ЗАМЕТКА-ПРО-ЦЕНУ", paymentNote: "П" }, tariffs: [tariffs[0]], siteUrl: SITE });
  assert.doesNotMatch(html, /ЗАМЕТКА-ПРО-ЦЕНУ/);
});

test("parentsUsText: {price} → «От X за 30 дней, » или «Фиксированная цена за 30 дней, »; остальные строки не меняются", () => {
  assert.equal(parentsUsText("{price}занимайтесь сколько нужно", "1 990 ₽"), "От 1 990 ₽ за 30 дней, занимайтесь сколько нужно");
  assert.equal(parentsUsText("{price}занимайтесь сколько нужно", ""), "Фиксированная цена за 30 дней, занимайтесь сколько нужно");
  assert.equal(parentsUsText("Круглосуточно", "1 990 ₽"), "Круглосуточно");
});

test("renderParentsPage: таблица «репетитор и ЕГЭ·ПРО» с минимальной ценой, шаги, тарифы, оплата за ребёнка, вопросы и FAQPage", () => {
  const html = renderParentsPage({ seo, tariffs, siteUrl: SITE });
  assert.match(html, /<h1>Подготовка к ЕГЭ, которую можно позволить себе каждый месяц<\/h1>/);
  assert.match(html, /<th scope="row">Стоимость<\/th><td>[^<]*<\/td><td>От 1\s990 ₽ за 30 дней, занимайтесь сколько нужно/);
  assert.equal([...html.matchAll(/<tr><th scope="row">/g)].length, 7, "все семь строк таблицы");
  assert.match(html, /<h2>Как оплатить за ребёнка<\/h2>/);
  assert.match(html, /<strong>АТТЕСТАТ<\/strong>: 1\s990 ₽, на 30 дней, 2 предмета/);
  assert.doesNotMatch(html, /Попробовать<\/strong>: 0/, "бесплатный тариф в списке платных не показывается");
  assert.match(html, /<h3>Это замена репетитору\?<\/h3>/);
  const faq = ldBlocks(html).find((b) => b["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, 7);
  const noTariffs = renderParentsPage({ seo, tariffs: [], siteUrl: SITE });
  assert.match(noTariffs, /Фиксированная цена за 30 дней, занимайтесь/);
  assert.doesNotMatch(noTariffs, /<h2>Тарифы<\/h2>/);
});

test("renderContactsPage: почта, срок ответа, каналы, реквизиты ИП; ContactPage с contactPoint", () => {
  const html = renderContactsPage({
    seo,
    info: { supportEmail: "support@ege-tutor.ru", replyWithinHours: 24, channels: [{ id: "tg", label: "Telegram", url: "https://t.me/egepro" }] },
    legal: { inn: "070804531260", ogrnip: "321072600021713" },
    siteUrl: SITE,
  });
  assert.match(html, /<h1>Напиши нам<\/h1>/);
  assert.match(html, /Ответим в течение одного дня\./);
  assert.match(html, /<a href="mailto:support@ege-tutor\.ru">support@ege-tutor\.ru<\/a>/);
  assert.match(html, /<a href="https:\/\/t\.me\/egepro" rel="noopener">Telegram<\/a>/);
  assert.match(html, /ИНН 070804531260<br>ОГРНИП 321072600021713/);
  const contact = ldBlocks(html).find((b) => b["@type"] === "ContactPage");
  assert.equal(contact.mainEntity.contactPoint.email, "support@ege-tutor.ru");
  const noLegal = renderContactsPage({ seo, info: { supportEmail: "s@e.ru", replyWithinHours: 48, channels: [] }, legal: null, siteUrl: SITE });
  assert.match(noLegal, /Ответим в течение 48 часов\./);
  assert.doesNotMatch(noLegal, /Реквизиты/);
});

test("legalTextToHtml / renderLegalPage: абзацы и переносы как в SPA, HTML экранируется, страница с noindex", () => {
  assert.equal(legalTextToHtml("Первый <b>абзац</b>\nвторая строка\n\nВторой абзац"), "<p>Первый &lt;b&gt;абзац&lt;/b&gt;<br>вторая строка</p>\n<p>Второй абзац</p>");
  assert.equal(legalTextToHtml(null), "");
  const html = renderLegalPage({ key: "offer", doc: { title: "Публичная оферта", content: "1. Общие положения\n\n2. Предмет", updated_at: "2026-09-01T09:00:00Z" }, seo, siteUrl: SITE });
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /<h1>Публичная оферта<\/h1>/);
  assert.match(html, /Редакция от 1 сентября 2026 г\./);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/oferta">/);
});

test("getBotPage: все пути из списка отдают 200 с h1, canonical, viewport и без http://; чужой путь — null (против локальной БД)", async () => {
  for (const path of BOT_PAGE_PATHS) {
    const r = await getBotPage(path, { siteUrl: SITE });
    assert.ok(r.status === 200 || (r.status === 404 && (path === "/oferta" || path === "/privacy")), `${path}: ${r.status}`);
    assert.match(r.html, /<h1>.+<\/h1>/, path);
    assert.match(r.html, /<meta name="viewport"/, path);
    assert.match(r.html, new RegExp(`<link rel="canonical" href="${SITE}${path === "/" ? "/" : path}">`), path);
    assert.doesNotMatch(r.html, /http:\/\//, path);
    for (const b of ldBlocks(r.html)) assert.ok(b["@context"] === "https://schema.org", path);
  }
  assert.equal(await getBotPage("/blog", { siteUrl: SITE }), null);
  assert.equal(await getBotPage("/admin", { siteUrl: SITE }), null);
});

test("страница родителей и контактов в React читает те же JSON, что и сервер; заголовки лендинга в Landing.tsx не разошлись с серверными", () => {
  const src = (p) => fs.readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  assert.match(src("src/components/ParentsView.tsx"), /docker\/api\/content\/parents\.json/);
  assert.match(src("src/components/ContactsView.tsx"), /docker\/api\/content\/contacts\.json/);
  assert.match(src("src/lib/content.ts"), /docker\/api\/content\/landing\.json/);
  assert.match(src("src/lib/tariffsContent.ts"), /docker\/api\/content\/tariffsPage\.json/);
  const landing = src("src/components/Landing.tsx");
  for (const [key, text] of Object.entries(LANDING_HEADINGS)) assert.ok(landing.includes(text), `Landing.tsx: нет заголовка «${text}» (${key}) — обновите LANDING_HEADINGS в botPages.js`);
});
