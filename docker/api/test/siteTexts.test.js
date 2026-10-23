// Согласованность текстов сайта: один публичный адрес почты, нет обещаний возврата денег, описания страниц не врут.
// Читает исходники репозитория (тексты страниц, письма, описания), поэтому ловит расхождения до выкатки.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PAGE_SEO } from "../botPages.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXT = new Set([".ts", ".tsx", ".js", ".json", ".html"]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === "test" || name.name === "dist") continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(name.name)) && !/\.test\./.test(name.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "docker/api")), path.join(root, "index.html")];
const read = (f) => fs.readFileSync(f, "utf8");
const rel = (f) => path.relative(root, f).replace(/\\/g, "/");

test("в тексте сайта и писем нет обещаний или условий возврата денег", () => {
  const re = /возврат[а-я]*\s+(денег|средств|платеж|оплат)|возврата\s+денег|условия оплаты и возврата|порядок возврата|гарантия возврата|вернём деньги|вернем деньги|refund/i;
  const bad = files.filter((f) => re.test(read(f))).map(rel);
  assert.deepEqual(bad, []);
});

test("страница оплаты родителя не содержит зашитого адреса почты: адрес показан только в «Контактах» (настройка в админке)", () => {
  const src = read(path.join(root, "src/components/ParentPayView.tsx"));
  assert.doesNotMatch(src, /(support|info|noreply|ege-pro-ai)@/); // подсказка в поле «почта для чека» (mama@example.com) — не адрес сервиса
});

test("описание главной не обещает предмет, которого нет в списке сайта (информатика), в том числе в index.html", () => {
  assert.doesNotMatch(DEFAULT_PAGE_SEO.home.description, /информатик/i);
  const seoTs = read(path.join(root, "src/lib/seo.ts"));
  assert.doesNotMatch(seoTs.slice(seoTs.indexOf("DEFAULT_SEO"), seoTs.indexOf("DEFAULT_SEO") + 900), /информатик/i);
  assert.doesNotMatch(read(path.join(root, "index.html")), /<meta[^>]+description[^>]+информатик/i);
});

test("описание страницы контактов не обещает мессенджеры: канал включается в админке и может отсутствовать", () => {
  const contacts = JSON.parse(read(path.join(root, "docker/api/content/contacts.json")));
  assert.doesNotMatch(contacts.seo.description, /мессенджер/i);
  assert.match(contacts.seo.description, /почта поддержки/i);
});
