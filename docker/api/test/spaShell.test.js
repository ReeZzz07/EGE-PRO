// Один документ для всех клиентов: готовая страница внутри оболочки сайта (docker/api/spaShell.js) и llms.txt для нейросетей.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { clearMemo, getSpaShell, memoize, mergeIntoShell, resetSpaShellCache, sendPage, stripSecurityHeaders } from "../spaShell.js";
import { renderLlmsTxt, renderTariffsPage } from "../botPages.js";
import { pool } from "./helpers.js";

after(() => pool.end());
afterEach(() => {
  resetSpaShellCache();
  clearMemo();
  delete process.env.WEB_ORIGIN;
});

// то, что отдаёт сервис web после сборки (index.html Vite с хешированными файлами)
const SHELL = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="СТАРОЕ ОПИСАНИЕ ДЛЯ ВСЕХ" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://ege-tutor.ru/" />
    <title>СТАРЫЙ ЗАГОЛОВОК ДЛЯ ВСЕХ</title>
    <meta property="og:title" content="СТАРЫЙ OG" />
    <meta property="og:description" content="СТАРЫЙ OG DESC" />
    <meta name="twitter:title" content="СТАРЫЙ TW" />
    <meta name="theme-color" content="#15172e" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc123.css" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const PAGE = `<!doctype html>
<html lang="ru"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<title>Тарифы — ЕГЭ·ПРО</title>
<meta name="description" content="Описание тарифов">
<link rel="canonical" href="https://ege-tutor.ru/tariffs">
<meta property="og:title" content="Тарифы — ЕГЭ·ПРО">
<script type="application/ld+json">{"@type":"ItemList"}</script>
</head><body>
<header><nav><a href="/">ЕГЭ·ПРО</a></nav></header>
<main>
<h1>Выбери, сколько предметов готовить</h1>
<p>АТТЕСТАТ: 1 990 ₽ за 30 дней. Цена $& и $1 без подстановок.</p>
</main>
<footer><p>Подвал</p></footer>
</body></html>`;

const count = (s, re) => (s.match(re) || []).length;

test("mergeIntoShell: у страницы свои title, описание, canonical, og и JSON-LD; прежние статические значения оболочки не остаются", () => {
  const html = mergeIntoShell(SHELL, PAGE);
  assert.equal(count(html, /<title>/g), 1);
  assert.match(html, /<title>Тарифы — ЕГЭ·ПРО<\/title>/);
  assert.doesNotMatch(html, /СТАРЫЙ|СТАРОЕ/);
  assert.equal(count(html, /name="description"/g), 1);
  assert.match(html, /<meta name="description" content="Описание тарифов">/);
  assert.equal(count(html, /rel="canonical"/g), 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/tariffs">/);
  assert.equal(count(html, /name="robots"/g), 1);
  assert.match(html, /<script type="application\/ld\+json">\{"@type":"ItemList"\}<\/script>/);
});

test("mergeIntoShell: приложение на месте (скрипт и стили сборки, favicon-цвет), charset и viewport не задвоены", () => {
  const html = mergeIntoShell(SHELL, PAGE);
  assert.match(html, /<script type="module" crossorigin src="\/assets\/index-abc123\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" crossorigin href="\/assets\/index-abc123\.css" \/>/);
  assert.match(html, /<meta name="theme-color"/);
  assert.equal(count(html, /charset=/gi), 1);
  assert.equal(count(html, /name="viewport"/g), 1);
});

test("mergeIntoShell: содержимое страницы лежит в #root (h1, текст, ссылки), а для браузеров с JS скрывается до старта приложения", () => {
  const html = mergeIntoShell(SHELL, PAGE);
  const root = html.slice(html.indexOf('<div id="root">'));
  assert.match(root, /<div id="prerender">/);
  assert.match(root, /<h1>Выбери, сколько предметов готовить<\/h1>/);
  assert.match(root, /<a href="\/">ЕГЭ·ПРО<\/a>/);
  assert.match(root, /Подвал/);
  assert.match(html, /html\.js #prerender\{visibility:hidden\}/);
  assert.match(html, /document\.documentElement\.className\+=" js"/);
});

test("mergeIntoShell: спецпоследовательности замены ($&, $1) в тексте страницы не искажаются", () => {
  const html = mergeIntoShell(SHELL, PAGE);
  assert.match(html, /Цена \$& и \$1 без подстановок\./);
});

test("mergeIntoShell: оболочка без контейнера root или страница без тела — null (вызывающий отдаст страницу как есть)", () => {
  assert.equal(mergeIntoShell("<html><head></head><body>нет root</body></html>", PAGE), null);
  assert.equal(mergeIntoShell(SHELL, "<html><head></head></html>"), null);
  assert.equal(mergeIntoShell(null, PAGE), null);
});

test("mergeIntoShell на настоящей странице тарифов: одна и та же оболочка, разные адреса — разные title и h1", () => {
  const seo = { ogImage: "", pages: { home: { title: "Главная", description: "д" }, tariffs: { title: "Тарифы — ЕГЭ·ПРО", description: "Описание тарифов" } } };
  const tariffsPage = renderTariffsPage({ seo, content: { title: "Выбери тариф", subtitle: "С", perSubjectNote: "", paymentNote: "П" }, tariffs: [{ id: "a", name: "АТТЕСТАТ", badge: null, price: 1990, basePrice: 1990, subjectsCount: 2, dailyAiLimit: null, features: [] }], siteUrl: "https://ege-tutor.ru" });
  const merged = mergeIntoShell(SHELL, tariffsPage);
  assert.match(merged, /<title>Тарифы — ЕГЭ·ПРО<\/title>/);
  assert.match(merged, /1\s990 ₽<\/strong> за 30 дней/);
  assert.match(merged, /"@type":"Offer"/);
});

test("stripSecurityHeaders: убирает CSP, Referrer-Policy и прочее от helmet, иначе приложение потеряло бы Метрику, шрифты и источник переходов", () => {
  const removed = [];
  stripSecurityHeaders({ removeHeader: (h) => removed.push(h) });
  for (const h of ["Content-Security-Policy", "Referrer-Policy", "Cross-Origin-Embedder-Policy", "Strict-Transport-Security"]) assert.ok(removed.includes(h), h);
});

function startWeb(html, status = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { "content-type": "text/html" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
const fakeRes = () => ({ headers: {}, removed: [], code: null, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, removeHeader(k) { this.removed.push(k); }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } });

test("sendPage: любому клиенту отдаёт страницу внутри оболочки web, без заголовков helmet и с перепроверкой кеша", async () => {
  const { server, origin } = await startWeb(SHELL);
  try {
    process.env.WEB_ORIGIN = origin;
    const res = fakeRes();
    await sendPage(res, 200, PAGE);
    assert.equal(res.code, 200);
    assert.match(res.body, /<script type="module" crossorigin src="\/assets\/index-abc123\.js">/);
    assert.match(res.body, /<h1>Выбери, сколько предметов готовить<\/h1>/);
    assert.equal(res.headers["cache-control"], "no-cache");
    assert.match(res.headers["content-type"], /text\/html/);
    assert.ok(res.removed.includes("Content-Security-Policy"));
  } finally {
    server.close();
  }
});

test("sendPage: web недоступен или отдал не оболочку — страница уходит как есть (контент на месте), 404-статус сохраняется", async () => {
  process.env.WEB_ORIGIN = "http://127.0.0.1:1"; // порт, где никто не слушает
  const res = fakeRes();
  await sendPage(res, 404, PAGE);
  assert.equal(res.code, 404);
  assert.equal(res.body, PAGE);

  const { server, origin } = await startWeb("<html>не оболочка</html>");
  try {
    resetSpaShellCache();
    process.env.WEB_ORIGIN = origin;
    assert.equal(await getSpaShell({ fresh: true }), null);
  } finally {
    server.close();
  }
});

test("memoize: считает один раз в пределах TTL, после TTL пересчитывает; ошибка не кешируется", async () => {
  let n = 0;
  assert.equal(await memoize("k", 60000, async () => ++n), 1);
  assert.equal(await memoize("k", 60000, async () => ++n), 1);
  assert.equal(await memoize("k", 0, async () => ++n), 2);
  await assert.rejects(() => memoize("err", 60000, async () => { throw new Error("сбой"); }));
  assert.equal(await memoize("err", 60000, async () => "ок"), "ок");
});

test("renderLlmsTxt: суть, механика, цены, условия оплаты, целевые действия, разделы и контакты; без возврата денег (против локальной БД)", async () => {
  const txt = await renderLlmsTxt({ siteUrl: "https://ege-tutor.ru" });
  assert.match(txt, /^# ЕГЭ·ПРО\n\n> /);
  for (const h of ["## В чём суть", "## Как это работает", "## Цены и тарифы", "## Условия оплаты", "## Целевые действия", "## Разделы сайта", "## Важно"]) assert.ok(txt.includes(h), h);
  assert.match(txt, /1\. [^\n]+/, "шаги механики пронумерованы");
  assert.match(txt, /- Пройти бесплатную диагностику: https:\/\/ege-tutor\.ru\/diagnostic/);
  assert.match(txt, /- Выбрать тариф: https:\/\/ege-tutor\.ru\/tariffs/);
  assert.match(txt, /СБП/);
  assert.doesNotMatch(txt, /возврат/i);
  assert.doesNotMatch(txt, /http:\/\//);
});
