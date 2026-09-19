// HTML-заглушка для краулеров и ботов соцсетей на / и /tariffs (см. @bot в docker/Caddyfile и
// комментарий у маршрута в server.js). Вынесено в отдельный модуль ради теста: разметка
// собирается чистой функцией без БД и Express.

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Раньше тело было пустым, а viewport отсутствовал — Яндекс.Вебмастер ругался на отсутствие
// viewport, а YandexBot/Googlebot (под матчер "bot" в Caddyfile попадают ВСЕ краулеры, не только
// боты мессенджеров) видели страницу без единого слова и без внутренних ссылок. Тело: заголовок,
// описание и ссылки на обе индексируемые страницы — берётся из тех же title/description, что и
// метатеги (редактируются в админке), так что расхождения с настоящим сайтом не копятся.
export function renderBotHtml({ title, description, canonicalUrl, ogImage, verificationMetaTags }) {
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${verificationMetaTags}
${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : ""}
<meta property="og:site_name" content="ЕГЭ·ПРО">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${
  ogImage
    ? `<meta property="og:image" content="${escapeHtml(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${escapeHtml(ogImage)}">`
    : `<meta name="twitter:card" content="summary">`
}
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
</head><body>
<header><nav><a href="/">ЕГЭ·ПРО</a> <a href="/tariffs">Тарифы</a></nav></header>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(description)}</p>
</main>
</body></html>
`;
}
