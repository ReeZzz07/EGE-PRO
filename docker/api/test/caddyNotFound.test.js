// Правило @notfound в docker/Caddyfile: неизвестный адрес получает настоящий 404, а страницы приложения, пути API и файлы — нет.
// Ошибка здесь опасна (SPA получил бы 404 вместо API или страницы), поэтому правило разбирается и проверяется тестом.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");
const caddy = read("docker/Caddyfile");
const block = caddy.slice(caddy.indexOf("@notfound {"), caddy.indexOf("}", caddy.indexOf("@notfound {")));
assert.ok(block, "в Caddyfile есть @notfound");

const patterns = [...block.matchAll(/^\s*not path (.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
const ext = new RegExp(block.match(/not path_regexp ext (.+)$/m)[1].trim());

function matchesPath(pattern, path) {
  if (pattern.endsWith("/*")) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}
/** true — Caddy ответит 404 (адрес не из известных). */
const isNotFound = (path) => !patterns.some((p) => matchesPath(p, path)) && !ext.test(path);

test("неизвестные адреса — 404: случайный путь, лишний сегмент у страницы, вложенный путь", () => {
  for (const p of ["/foo", "/tariffs/extra", "/parents/", "/wp-admin", "/phpmyadmin", "/ege-pro", "/blog2", "/ege", "/xyz/abc/def"]) assert.equal(isNotFound(p), true, p);
});

test("страницы сайта не получают 404: главная, тарифы, родителям, контакты, оферта, блог, предметы, ссылки из писем и оплаты", () => {
  for (const p of ["/", "/tariffs", "/parents", "/contacts", "/oferta", "/privacy", "/blog", "/blog/stat", "/ege/biologiya", "/llms.txt", "/renew", "/onboarding", "/subjects", "/plan", "/diagnostic", "/review", "/payment/return", "/reset-password", "/verify-email", "/pay-for/abcdefghijklmnopqrstuvwx"]) {
    assert.equal(isNotFound(p), false, p);
  }
});

test("файлы и служебные адреса не получают 404: скрипты, картинки, robots.txt, sitemap.xml, favicon", () => {
  for (const p of ["/assets/index-abc.js", "/assets/index-abc.css", "/robots.txt", "/sitemap.xml", "/favicon.svg", "/index.html", "/storage/avatars/a.png"]) assert.equal(isNotFound(p), false, p);
});

test("каждый префикс API из vite.config.js (то, что приложение вызывает через web) исключён из 404 — и сам адрес, и всё под ним", () => {
  const keys = [...read("vite.config.js").matchAll(/^\s*"(\/[a-zA-Z0-9_./-]+)": \{ target/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 15, `нашлось префиксов: ${keys.length}`);
  for (const k of keys) {
    assert.equal(isNotFound(k), false, k);
    assert.equal(isNotFound(`${k}/что-то/глубже`), false, `${k}/…`);
  }
});

test("каждый путь приложения из src/lib/routes.ts исключён из 404", () => {
  const routes = read("src/lib/routes.ts");
  const paths = new Set([...routes.matchAll(/case "(\/[a-z0-9/-]+)":/g)].map((m) => m[1]));
  for (const m of routes.matchAll(/pathname\.startsWith\("(\/[a-z0-9-]+\/)"\)/g)) paths.add(`${m[1]}пример`);
  for (const m of routes.matchAll(/pathname === "(\/[a-z0-9/-]+)"/g)) paths.add(m[1]);
  assert.ok(paths.size >= 12, `нашлось путей: ${paths.size}`);
  for (const p of paths) assert.equal(isNotFound(p), false, p);
});

test("правило работает только для GET и HEAD и идёт после @public: страницы сайта обрабатываются раньше", () => {
  assert.match(block, /method GET HEAD/);
  assert.ok(caddy.indexOf("handle @public") < caddy.indexOf("handle @notfound"));
  assert.match(caddy, /handle @notfound \{\s*rewrite \* \/__not-found/);
});
