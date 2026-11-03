// Один и тот же документ для всех клиентов: готовая страница (текст, h1, уникальные title/description/canonical, JSON-LD) внутри
// настоящей оболочки сайта (скрипты и стили сборки). Раньше готовый HTML получали только боты по User-Agent, а любой другой клиент
// (SEO-аудит, скрипт, нейросеть с обычным User-Agent) видел пустой <div id="root"> с одинаковым title на всех адресах.
//
// Как это работает: API берёт у сервиса web настоящий index.html (с хешированными адресами скриптов и стилей текущей сборки),
// подставляет в его <head> теги страницы и кладёт содержимое в <div id="root">. React при старте заменяет его приложением
// (createRoot очищает контейнер), а до старта блок скрыт стилем html.js #prerender — человек видит то же, что и раньше.
// Клиент без JavaScript видит весь текст.
import { escapeHtml } from "./botHtml.js";
const STRIPPED_HEADERS = [
  "Content-Security-Policy",
  "Content-Security-Policy-Report-Only",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Embedder-Policy",
  "Cross-Origin-Resource-Policy",
  "Origin-Agent-Cluster",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-DNS-Prefetch-Control",
  "X-Download-Options",
  "X-Frame-Options",
  "X-Permitted-Cross-Domain-Policies",
  "X-XSS-Protection",
];

/** helmet (см. server.js) рассчитан на JSON API: его CSP запретил бы приложению инлайн-скрипты, Метрику и шрифты, а Referrer-Policy
 *  обнулил бы источник переходов. Для HTML сайта нужны ровно те заголовки, что были, когда его отдавал web, то есть никаких. */
export function stripSecurityHeaders(res) {
  for (const h of STRIPPED_HEADERS) res.removeHeader(h);
}

const SHELL_TTL_MS = 30 * 1000;
let shellCache = { at: 0, html: null };

/** Настоящий index.html текущей сборки от сервиса web; null — недоступен (идёт пересборка и т.п.). Кеш 30 секунд: после выкладки новой
 *  сборки хеши файлов меняются, и устаревший шаблон ссылался бы на удалённые скрипты. */
export async function getSpaShell({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && now - shellCache.at < SHELL_TTL_MS) return shellCache.html;
  let html = null;
  try {
    const origin = process.env.WEB_ORIGIN || "http://web:3000";
    const res = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(2000) });
    const text = res.ok ? await res.text() : "";
    html = /<div id="root">\s*<\/div>/.test(text) && text.includes("</head>") ? text : null;
  } catch (e) {
    console.warn("не удалось получить index.html от web для страницы с готовым содержимым:", e?.message ?? e);
  }
  shellCache = { at: now, html };
  return html;
}

export function resetSpaShellCache() {
  shellCache = { at: 0, html: null };
}

const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return "";
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? "" : s.slice(i + a.length, j);
};

const HIDE_PRERENDER = `<style>html.js #prerender{visibility:hidden}</style>\n<script>document.documentElement.className+=" js"</script>`;

/** Подставляет в оболочку сайта (shell) head и содержимое готового документа страницы (pageHtml из botPages.js / blogBot.js).
 *  null — оболочка не подходит (нет контейнера root): вызывающий отдаёт готовый документ как есть. */
export function mergeIntoShell(shell, pageHtml) {
  if (!shell || !/<div id="root">\s*<\/div>/.test(shell) || !shell.includes("</head>")) return null;
  const pageHead = between(pageHtml, "<head>", "</head>")
    .replace(/<meta charset[^>]*>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .trim();
  const pageBody = between(pageHtml, "<body>", "</body>").trim();
  if (!pageBody) return null;
  let out = shell
    // теги страницы заменяют статические значения оболочки (одинаковые на всех адресах)
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="(?:description|robots)"[^>]*>\s*/gi, "")
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "");
  out = out.replace("</head>", () => `${pageHead}\n${HIDE_PRERENDER}\n</head>`);
  out = out.replace(/<div id="root">\s*<\/div>/, () => `<div id="root"><div id="prerender">\n${pageBody}\n</div></div>`);
  return out;
}

/** Ответ страницы: готовый документ внутри оболочки сайта. Нет оболочки — сам документ (контент на месте, приложения нет). */
export async function sendPage(res, status, pageHtml) {
  stripSecurityHeaders(res);
  res.setHeader("content-type", "text/html; charset=utf-8");
  // шаблон привязан к текущей сборке (хеши скриптов), поэтому кеш браузера и прокси только с перепроверкой
  res.setHeader("Cache-Control", "no-cache");
  const shell = await getSpaShell();
  res.status(status).send((shell ? mergeIntoShell(shell, pageHtml) : null) ?? pageHtml);
}

/** Оболочка для служебных страниц приложения (диагностика, онбординг, оплата…): та же, но с «noindex, follow» вместо «index, follow» и без
 *  canonical на главную. Заголовок X-Robots-Tag от Caddy и метка в самом документе должны говорить одно и то же, иначе сигналы спорят. */
export function toNoindexShell(shell) {
  const robots = /<meta\s+name="robots"[^>]*>/i;
  const tag = '<meta name="robots" content="noindex, follow" />';
  let out = shell.replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "");
  out = robots.test(out) ? out.replace(robots, tag) : out.replace("</head>", () => `${tag}\n</head>`);
  return out;
}

/** Короткий HTML для @private-маршрутов (диагностика, /try, кабинет…): H1 + лид, noindex. Caddy шлёт исходный path в X-Private-Path. */
export function privatePrerenderHtml(pathname = "/app") {
  const raw = String(pathname || "/app").split("?")[0] || "/app";
  const key = raw.startsWith("/try")
    ? "/try"
    : raw.startsWith("/app")
      ? "/app"
      : raw.startsWith("/pay-for/")
        ? "/pay-for"
        : raw;
  const pages = {
    "/diagnostic": {
      title: "Диагностика уровня ЕГЭ — ЕГЭ·ПРО",
      h1: "Диагностика уровня по предмету",
      p: "8–12 заданий за 7–10 минут: уровень, слабые темы и персональный план. Это не экзамен — ошибаться нормально.",
    },
    "/try": {
      title: "Попробовать задание без регистрации — ЕГЭ·ПРО",
      h1: "Попробуйте задание без регистрации",
      p: "Одно задание формата ЕГЭ, короткий разбор и предложение сохранить прогресс в аккаунте.",
    },
    "/renew": {
      title: "Продление тарифа — ЕГЭ·ПРО",
      h1: "Продление доступа",
      p: "Разовая оплата на 30 дней без автосписаний. Если нужна помощь — напишите на странице контактов.",
    },
    "/onboarding": {
      title: "Онбординг — ЕГЭ·ПРО",
      h1: "Настройка подготовки",
      p: "Выберите предметы и получите маршрут: диагностика, план, банк заданий и ИИ-репетитор.",
    },
    "/subjects": {
      title: "Выбор предметов — ЕГЭ·ПРО",
      h1: "Выбор предметов ЕГЭ",
      p: "Отметьте предметы, которые готовите — дальше диагностика и персональный план.",
    },
    "/plan": {
      title: "План подготовки — ЕГЭ·ПРО",
      h1: "Персональный план подготовки",
      p: "План строится после диагностики: слабые темы, порядок повторения и тренировки.",
    },
    "/review": {
      title: "Отзыв — ЕГЭ·ПРО",
      h1: "Оставить отзыв",
      p: "Расскажите, что помогло в подготовке — отзывы публикуем только с согласия.",
    },
    "/app": {
      title: "Кабинет — ЕГЭ·ПРО",
      h1: "Личный кабинет ЕГЭ·ПРО",
      p: "Банк заданий, ИИ-репетитор, тетрадь ошибок и статистика — после входа в аккаунт.",
    },
    "/pay-for": {
      title: "Оплата родителем — ЕГЭ·ПРО",
      h1: "Оплата тарифа по ссылке",
      p: "Разовая оплата через ЮKassa на 30 дней, без сохранения карты и автопродления.",
    },
    "/payment/return": {
      title: "Результат оплаты — ЕГЭ·ПРО",
      h1: "Результат оплаты",
      p: "Если деньги списались, доступ обычно включается в течение нескольких минут.",
    },
    "/reset-password": {
      title: "Сброс пароля — ЕГЭ·ПРО",
      h1: "Сброс пароля",
      p: "Задайте новый пароль по ссылке из письма.",
    },
    "/verify-email": {
      title: "Подтверждение почты — ЕГЭ·ПРО",
      h1: "Подтверждение почты",
      p: "Подтвердите email, чтобы сохранить прогресс и открыть полный доступ к платформе.",
    },
  };
  const meta = pages[key] || {
    title: "ЕГЭ·ПРО",
    h1: "ЕГЭ·ПРО",
    p: "Онлайн-тренажёр подготовки к ЕГЭ с ИИ-репетитором: диагностика, план и задания формата открытого банка ФИПИ.",
  };
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, follow">
<title>${escapeHtml(meta.title)}</title>
</head><body>
<main>
<h1>${escapeHtml(meta.h1)}</h1>
<p>${escapeHtml(meta.p)}</p>
<p><a href="/">На главную</a> · <a href="/contacts">Контакты</a> · <a href="/tariffs">Тарифы</a></p>
</main>
</body></html>
`;
}

const MEMO_MAX = 300;
const memo = new Map();

/** Короткий кеш готовых документов: страницы теперь открывают все посетители, а не только боты, и каждый показ без кеша — запросы в БД. */
export async function memoize(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(key, { at: Date.now(), value });
  return value;
}

export function clearMemo() {
  memo.clear();
}
