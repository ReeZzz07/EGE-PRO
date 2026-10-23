// Общая обвязка HTML-страниц для краулеров и нейросетей (шапка документа, навигация, подвал, JSON-LD, мелкие помощники).
// Её используют blogBot.js (/blog, /blog/<статья>) и botPages.js (/, /tariffs, /parents, /contacts, /oferta, /privacy).
import { escapeHtml } from "./botHtml.js";

const BACKSLASH = String.fromCharCode(92);

export const siteName = "ЕГЭ·ПРО";
export const NAV = `<header><nav><a href="/">${siteName}</a> <a href="/tariffs">Тарифы</a> <a href="/blog">База знаний</a> <a href="/parents">Родителям</a> <a href="/contacts">Контакты</a></nav></header>`;
export const FOOTER = `<footer><p>${siteName} — учебный проект: тренажёр для подготовки к ЕГЭ с ИИ-репетитором. Задания взяты из открытого банка ФИПИ; сервис не является официальным ресурсом ФИПИ или Рособрнадзора.</p></footer>`;

/** JSON-LD внутри <script>: «<» экранируем, чтобы строка вроде «</script>» в заголовке не закрыла тег. */
export function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, `${BACKSLASH}u003c`)}</script>`;
}

export const absolute = (siteUrl, url) => (!url ? "" : /^https?:\/\//i.test(url) ? url : url.startsWith("/") && siteUrl ? `${siteUrl}${url}` : "");
export const iso = (v) => (v ? new Date(v).toISOString() : null);
export const dateRu = (v) => new Date(v).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
export const trimText = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function head({ title, description, canonicalUrl, ogImage, ogType = "website", verificationMetaTags = "", noindex = false, extra = "" }) {
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

