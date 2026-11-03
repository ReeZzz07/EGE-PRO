// Оглавление статьи: id на h2/h3 после sanitize, чтобы сайдбар мог якориться на видимый текст.
import { sanitizeArticleHtml, slugify } from "./blog";

export type ArticleTocItem = { id: string; text: string; level: 2 | 3 };

export function prepareArticleHtml(rawHtml: string): { html: string; toc: ArticleTocItem[] } {
  const clean = sanitizeArticleHtml(rawHtml);
  if (typeof DOMParser === "undefined") return { html: clean, toc: [] };
  const doc = new DOMParser().parseFromString(clean, "text/html");
  const toc: ArticleTocItem[] = [];
  const used = new Set<string>();
  doc.querySelectorAll("h2, h3").forEach((el, i) => {
    const text = (el.textContent || "").trim();
    if (!text) return;
    let id = slugify(text) || `sec-${i}`;
    if (used.has(id)) id = `${id}-${i}`;
    used.add(id);
    el.id = id;
    toc.push({ id, text, level: el.tagName === "H2" ? 2 : 3 });
  });
  return { html: doc.body.innerHTML, toc };
}
