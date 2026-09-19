// HTML-заглушка для краулеров (Яндекс.Вебмастер: "Тег viewport не указан", пустое тело у YandexBot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBotHtml, escapeHtml } from "../botHtml.js";

const base = {
  title: "ЕГЭ·ПРО — тренажёр с ИИ-репетитором",
  description: "Тренажёр для подготовки к ЕГЭ с ИИ-репетитором.",
  canonicalUrl: "https://ege-tutor.ru/",
  ogImage: "https://ege-tutor.ru/storage/seo/og.jpg",
  verificationMetaTags: '<meta name="yandex-verification" content="abc">',
};

test("renderBotHtml: содержит viewport — Вебмастер жаловался на его отсутствие", () => {
  assert.match(renderBotHtml(base), /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
});

test("renderBotHtml: тело не пустое — заголовок, описание и внутренние ссылки на обе страницы", () => {
  const html = renderBotHtml(base);
  const body = html.slice(html.indexOf("<body>"));
  assert.match(body, /<h1>ЕГЭ·ПРО — тренажёр с ИИ-репетитором<\/h1>/);
  assert.match(body, /<p>Тренажёр для подготовки к ЕГЭ с ИИ-репетитором\.<\/p>/);
  assert.match(body, /<a href="\/">/);
  assert.match(body, /<a href="\/tariffs">/);
});

test("renderBotHtml: внутренние ссылки относительные — никаких http:// внутри разметки", () => {
  assert.doesNotMatch(renderBotHtml(base), /http:\/\//);
});

test("renderBotHtml: сохраняет verification-теги, canonical, og:image — то, ради чего заглушка и существует", () => {
  const html = renderBotHtml(base);
  assert.match(html, /<meta name="yandex-verification" content="abc">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ege-tutor\.ru\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/ege-tutor\.ru\/storage\/seo\/og\.jpg">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
});

test("renderBotHtml: без картинки и canonical — не выводит пустые og:image/canonical", () => {
  const html = renderBotHtml({ ...base, ogImage: "", canonicalUrl: "" });
  assert.doesNotMatch(html, /og:image/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
});

test("renderBotHtml: экранирует HTML в заголовке и описании (в теле тоже, не только в метатегах)", () => {
  const html = renderBotHtml({ ...base, title: 'A <b>"x"</b>', description: "1 & 2" });
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<h1>A &lt;b&gt;&quot;x&quot;&lt;\/b&gt;<\/h1>/);
  assert.match(html, /<p>1 &amp; 2<\/p>/);
});

test("escapeHtml: экранирует & < > \"", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});
