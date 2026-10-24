// Страницы для краулеров и нейросетей: /, /tariffs, /parents, /contacts, /oferta, /privacy (docker/api/botPages.js).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOT_PAGE_PATHS,
  LANDING_HEADINGS,
  DEFAULT_PAGE_SEO,
  getBotPage,
  renderNotFoundPage,
  getSubjectPage,
  getSubjectPageData,
  availableSubjectSlugs,
  renderSubjectPage,
  subjectBySlug,
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
  assert.match(html, /<li><a href="\/ege\/matematika-profil">Математика \(профиль\)<\/a>: 4\s774 задания — /);
  assert.match(html, /<li><a href="\/ege\/russkii-yazyk">Русский язык<\/a>: 7\s370 заданий — /);
  assert.match(html, /В банке 12\s144 задания из открытого банка ФИПИ по 2 предметам\./);
  assert.match(html, new RegExp(LANDING_HEADINGS.subjects));
  assert.match(html, /<h3>Диагностика<\/h3><p>7–10 минут\.<\/p>/);
  assert.match(html, /<h3>Диагностика уровня<\/h3>/);
  assert.match(html, /<tr><th scope="row">АТТЕСТАТ<\/th><td>1\s990 ₽ за 30 дней<\/td><td>2 на выбор<\/td><td>без лимита<\/td><\/tr>/);
  assert.match(html, /<tr><th scope="row">Попробовать<\/th><td>0 ₽<\/td><td>2 на выбор<\/td><td>до 3 обращений в день<\/td><\/tr>/);
  assert.match(html, /<th scope="col">Тариф<\/th><th scope="col">Цена<\/th><th scope="col">Предметы<\/th><th scope="col">ИИ-репетитор<\/th>/);
  assert.match(html, /<blockquote><p>Помогло разобраться<\/p><footer>Аня, Математика \(профиль\), оценка 5 из 5<\/footer><\/blockquote>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/ege-tutor\.ru\/storage\/seo\/og\.jpg">/);
  const types = ldBlocks(html).map((b) => b["@type"]);
  assert.deepEqual(types, ["Organization", "WebSite", "SoftwareApplication", "FAQPage"]);
  const app = ldBlocks(html).find((b) => b["@type"] === "SoftwareApplication");
  assert.deepEqual(app.offers.map((o) => [o.name, o.price]), tariffs.map((t) => [t.name, t.price.toFixed(2)]));
  assert.equal(app.aggregateRating, undefined, "рейтингов нет");
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
  for (const [key, text] of Object.entries(LANDING_HEADINGS).filter(([k]) => k !== "cta" && k !== "faq")) assert.ok(landing.includes(text), `Landing.tsx: нет заголовка «${text}» (${key}) — обновите LANDING_HEADINGS в botPages.js`);
  assert.match(landing, /docker\/api\/content\/landingStatic\.json/);
  assert.match(landing, /landingStatic\.ctaFinal\.title/);
});

// ─────────────────────── посадочные страницы предметов ───────────────────────

const subjectContent = { total: 11252, sections: [{ name: "Анатомия и физиология", n: 2284 }, { name: "Зоология", n: 1225 }], topics: [{ name: "Клетка", n: 300 }] };

test("subjectBySlug: страницы только у русского, профильной математики, обществознания и биологии; у остальных предметов страниц нет", () => {
  assert.deepEqual(["russkii-yazyk", "matematika-profil", "obschestvoznanie", "biologiya"].map((x) => subjectBySlug(x)?.id), ["rus", "math", "soc", "bio"]);
  for (const slug of ["fizika", "himiya", "istoriya", "literatura", "angliiskii-yazyk", "geografiya", "informatika", "matematika-bazovyi-uroven", "", "x"]) assert.equal(subjectBySlug(slug), null, slug);
});

test("renderSubjectPage: h1 «по биологии», число заданий, разделы и темы, шаги, тарифы, вопросы со склонением, ссылки на другие предметы; Course, FAQPage, BreadcrumbList", () => {
  const html = renderSubjectPage({
    subject: subjectBySlug("biologiya"),
    content: subjectContent,
    tariffs,
    steps: [{ n: "01", t: "Диагностика", d: "7–10 минут." }],
    paymentNote: "Разовая оплата на 30 дней.",
    others: [{ slug: "russkii-yazyk", name: "Русский язык" }],
    seo,
    siteUrl: SITE,
  });
  assert.match(html, /<title>Подготовка к ЕГЭ по биологии — ЕГЭ·ПРО<\/title>/);
  assert.match(html, /<h1>Подготовка к ЕГЭ по биологии<\/h1>/);
  assert.match(html, /11\s252 задания из открытого банка ФИПИ по предмету «Биология»/);
  assert.match(html, /<li>Анатомия и физиология: 2\s284 задания<\/li>/);
  assert.match(html, /<h3>Самые большие темы<\/h3>/);
  assert.match(html, /<h3>Диагностика<\/h3><p>7–10 минут\.<\/p>/);
  assert.match(html, /<strong>АТТЕСТАТ<\/strong>: 1\s990 ₽ за 30 дней/);
  assert.match(html, /Разовая оплата на 30 дней\./);
  assert.match(html, /<h3>С чего начать подготовку к ЕГЭ по биологии\?<\/h3>/);
  assert.match(html, /<a href="\/diagnostic">Пройти бесплатную диагностику по предмету<\/a>/);
  assert.match(html, /<a href="\/ege\/russkii-yazyk">Русский язык<\/a>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/ege\/biologiya">/);
  assert.deepEqual(ldBlocks(html).map((b) => b["@type"]), ["Course", "FAQPage", "BreadcrumbList"]);
  assert.doesNotMatch(html, /возврат/i);
  // УТП — последний раздел страницы, с кнопкой диагностики по предмету
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  const lastH2 = main.lastIndexOf("<h2>");
  assert.match(main.slice(lastH2), /^<h2>Почему ЕГЭ·ПРО<\/h2>/);
  assert.match(main.slice(lastH2), /<strong>Объясняет, а не решает за тебя<\/strong>/);
  assert.match(main.slice(lastH2), /<a href="\/diagnostic">Пройти бесплатную диагностику по предмету «Биология»<\/a>/);
});

test("getSubjectPage: четыре предмета — 200 с разными title; остальные предметы, неизвестный и пустой адрес — 404 с noindex (против локальной БД)", async () => {
  const titles = new Set();
  for (const slug of ["russkii-yazyk", "matematika-profil", "obschestvoznanie", "biologiya"]) {
    const r = await getSubjectPage(slug, { siteUrl: SITE });
    assert.equal(r.status, 200, slug);
    assert.match(r.html, /<h1>Подготовка к ЕГЭ по [^<]+<\/h1>/, slug);
    assert.match(r.html, /<h2>Разделы и темы в тренажёре<\/h2>/, slug);
    titles.add(r.html.match(/<title>(.*?)<\/title>/)[1]);
  }
  assert.equal(titles.size, 4, "у каждой страницы свой title");
  for (const slug of ["fizika", "informatika", "net-takoi", ""]) {
    const r = await getSubjectPage(slug);
    assert.equal(r.status, 404, slug);
    assert.match(r.html, /noindex/);
  }
});

test("availableSubjectSlugs и getSubjectPageData: в sitemap только четыре адреса; JSON для приложения с теми же разделами и темами", async () => {
  assert.deepEqual((await availableSubjectSlugs()).sort(), ["biologiya", "matematika-profil", "obschestvoznanie", "russkii-yazyk"]);
  const d = await getSubjectPageData("obschestvoznanie");
  assert.equal(d.id, "soc");
  assert.ok(d.total > 0 && d.sections.length > 0 && d.topics.length > 0);
  assert.equal(await getSubjectPageData("fizika"), null);
});

test("subjects.json: названия и описания предметов — дословно как в src/data/tasks.ts (одно описание на сайте и на странице для роботов)", () => {
  const tasksTs = fs.readFileSync(new URL("../../../src/data/tasks.ts", import.meta.url), "utf8");
  const data = JSON.parse(fs.readFileSync(new URL("../content/subjects.json", import.meta.url), "utf8"));
  for (const id of data.landingSubjects) {
    assert.ok(tasksTs.includes(`name: "${data.subjects[id].name}"`), `${id}: имя`);
    assert.ok(tasksTs.includes(`desc: "${data.subjects[id].desc}"`), `${id}: описание разошлось с tasks.ts`);
  }
});

// ─────────────────────── главная для роботов = то, что видит человек ───────────────────────

test("renderHomePage: цифры банка, кнопки, пример задания, описания предметов, «принцип платформы» с диалогом, методическая опора и финальный призыв", () => {
  const html = renderHomePage({
    seo,
    landing: { hero: { title: "Заголовок", subtitle: "Подзаголовок" }, capabilities: [], process: [], faq: [] },
    subjects: [{ id: "math", name: "Математика (профиль)", total: 4774, points: 5000, essay: 100 }, { id: "fiz", name: "Физика", total: 2683, points: 3000, essay: 50 }],
    tariffs,
    reviews: [],
    paymentNote: "Разовая оплата.",
    siteUrl: SITE,
  });
  assert.match(html, /<a href="\/diagnostic">Определить свой уровень<\/a> · <a href="\/diagnostic">Начать бесплатно<\/a>/);
  assert.match(html, /<li><strong>7\s457<\/strong> заданий в банке<\/li>/);
  assert.match(html, /<li><strong>2<\/strong> предметов<\/li>/);
  assert.match(html, /<li><strong>8\s000<\/strong> первичных баллов<\/li>/);
  assert.match(html, /<li><strong>150<\/strong> заданий с развёрнутым ответом<\/li>/);
  assert.match(html, /<h2>Так выглядит задание в тренажёре<\/h2>/);
  assert.match(html, /№ 99566 в банке ФИПИ\. Тема: Логарифмические уравнения\./);
  assert.match(html, /log₂\(x − 3\) = 4/);
  assert.match(html, /Кинематика, динамика, законы сохранения, электричество<\/li>/, "описание предмета рядом с названием");
  assert.match(html, /<h2>Принцип платформы: ИИ не решает за тебя, а помогает разобраться\.<\/h2>/);
  assert.match(html, /Ученик: Просто скажи ответ, мне некогда/);
  assert.match(html, /ИИ-репетитор: Я не могу дать готовый ответ/);
  assert.match(html, /<strong>Методическая опора:<\/strong> задания и критерии ориентируются/);
  assert.match(html, /Ошибаться нормально/);
  assert.doesNotMatch(html, /Скоро добавим/);
  assert.match(html, /Начни с любого из 2 предметов — дальше сможешь тренировать все\./);
});

test("renderNotFoundPage: noindex, понятный текст и ссылки на разделы; без canonical", () => {
  const html = renderNotFoundPage();
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /<h1>Страница не найдена<\/h1>/);
  assert.match(html, /<a href="\/tariffs">тарифы<\/a>/);
  assert.doesNotMatch(html, /rel="canonical"/);
});

test("на главной (приложение) нет противоречия «Скоро добавим остальные предметы» рядом с «Начни с любого из N»", () => {
  const landing = fs.readFileSync(new URL("../../../src/components/Landing.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(landing, /Скоро добавим/);
  assert.match(landing, /landingStatic\.subjectsIntro/);
});

// ─────────────────────── главная по ТЗ: новые блоки ───────────────────────

const homeArgs = () => ({
  seo,
  landing: { hero: { title: "Заголовок", subtitle: "Подзаголовок" }, capabilities: [], process: [{ n: "01", icon: "target", t: "Диагностика", d: "7–10 минут." }], faq: [{ q: "Вопрос?", a: "Ответ." }] },
  subjects: [{ id: "math", name: "Математика (профиль)", total: 4774, points: 5000, essay: 100 }, { id: "fiz", name: "Физика", total: 2683, points: 3000, essay: 50 }],
  tariffs,
  reviews: [],
  articles: [{ slug: "znakomstvo-s-ege-pro", title: "Знакомство с ЕГЭ·ПРО", excerpt: "Как устроена платформа" }],
  perSubjectNote: "при поштучной покупке — от 1290 ₽/мес за предмет",
  siteUrl: SITE,
});

test("renderHomePage: порядок блоков по ТЗ и все новые блоки на месте", () => {
  const html = renderHomePage(homeArgs());
  const order = ["<h1>", "<h2>Что такое ЕГЭ·ПРО</h2>", "<h2>С какого предмета", "<h2>Четыре шага", "<h2>Принцип платформы", "<h3>Три уровня подсказок</h3>", "<h2>Чем ИИ-репетитор ЕГЭ·ПРО отличается от обычной нейросети</h2>", "<h2>Проверка сочинения и развёрнутых ответов</h2>", "<h2>Тарифы и оплата</h2>", "<h2>Ограничения — честно</h2>", "<h2>Для родителей</h2>", "<h2>Частые вопросы</h2>", "<h2>Последние статьи</h2>", "<h2>Пройди диагностику"];
  let at = -1;
  for (const h of order) {
    const i = html.indexOf(h, at + 1);
    assert.ok(i > at, "блок «" + h + "» на месте и после предыдущего");
    at = i;
  }
});

test("renderHomePage: короткий ответ с живыми цифрами, три уровня подсказок, пять отличий, проверка сочинений с числом заданий", () => {
  const html = renderHomePage(homeArgs());
  assert.match(html, /В банке 7\s457 заданий в формате Открытого банка заданий ФИПИ по 2 предметам\./);
  assert.match(html, /<li><strong>Уровень 1: намёк на тему<\/strong>/);
  assert.match(html, /<li><strong>Уровень 3: почти полный разбор<\/strong>/);
  assert.equal((html.match(/<h2>Чем ИИ-репетитор[\s\S]*?<\/ul>/)[0].match(/<li>/g) ?? []).length, 5);
  assert.match(html, /В банке 150 заданий с развёрнутым ответом\./);
  assert.doesNotMatch(html, /\{(tasks|subjects|essay)\}/, "подстановки раскрыты");
});

test("renderHomePage: тарифы — HTML-таблица, условия оплаты, поштучная цена из настроек, три кнопки диагностики, внутренние ссылки из ТЗ", () => {
  const html = renderHomePage(homeArgs());
  assert.match(html, /<table>[\s\S]*<\/table>/);
  assert.match(html, /На всех тарифах есть диагностика, персональный план и пробные варианты\. При поштучной покупке — от 1290 ₽\/мес за предмет\./);
  assert.match(html, /картой или через СБП, через ЮKassa, без сохранения карты и без автопродления\. Тариф включается сразу после оплаты, чек приходит на почту\. Оплатить может родитель/);
  assert.ok((html.match(/<a href="\/diagnostic">/g) ?? []).length >= 3, "кнопок диагностики не меньше трёх");
  for (const href of ["/tariffs", "/parents", "/blog/ii-repetitor-protiv-zhivogo-repetitora", "/blog/kak-rabotaet-diagnostika-i-plan", "/blog/znakomstvo-s-ege-pro"]) assert.ok(html.includes('href="' + href + '"'), href);
});

test("renderHomePage: нет запрещённого ТЗ — возврата денег, отзывов без данных, рейтингов, «лучший», гарантий балла", () => {
  const html = renderHomePage(homeArgs());
  assert.doesNotMatch(html, /возврат/i);
  assert.doesNotMatch(html, /Отзывы учеников/);
  assert.doesNotMatch(html, /лучш(ий|ая|ее) (сервис|тренажёр|платформа)/i);
  assert.doesNotMatch(html, /гарантир(уем|ует) (балл|результат)/i);
  assert.doesNotMatch(html, /фото|PDF|рукописн|живые преподаватели|хранятся в России/i);
});

test("renderHomePage: заголовок и описание по умолчанию соответствуют ТЗ и совпадают с настройками приложения", () => {
  assert.equal(DEFAULT_PAGE_SEO.home.title, "Тренажёр ЕГЭ с ИИ-репетитором — ЕГЭ·ПРО: задания ФИПИ бесплатно");
  assert.ok(DEFAULT_PAGE_SEO.home.title.length <= 70);
  assert.ok(DEFAULT_PAGE_SEO.home.description.length <= 165);
  const seoTs = fs.readFileSync(new URL("../../../src/lib/seo.ts", import.meta.url), "utf8");
  assert.ok(seoTs.includes(DEFAULT_PAGE_SEO.home.title) && seoTs.includes(DEFAULT_PAGE_SEO.home.description), "src/lib/seo.ts совпадает с DEFAULT_PAGE_SEO");
});

test("Landing.tsx читает landingMore.json — тот же файл, что сервер; заголовок FAQ и подстановки не разошлись", () => {
  const landing = fs.readFileSync(new URL("../../../src/components/Landing.tsx", import.meta.url), "utf8");
  assert.match(landing, /docker\/api\/content\/landingMore\.json/);
  assert.match(landing, /landingMore\.headings\.faq/);
  for (const k of ["shortAnswer", "ctaMid", "hints", "diff", "essay", "tariffs", "limits", "parents"]) assert.ok(landing.includes("landingMore." + k), k);
  assert.match(landing, /\{tasks\}/);
});
