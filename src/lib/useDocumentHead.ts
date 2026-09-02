// Простановка <title>/meta на публичных страницах — вручную, без react-helmet: страниц, которым
// это вообще нужно, всего четыре (см. lib/routes.ts), а сам хук — десяток строк upsert'а тегов.
// Работает только на клиенте (CSR, SSR нет) — но современный Googlebot дожидается выполнения JS
// и читает DOM после него, так что для индексации этого достаточно; для превью в мессенджерах,
// которые JS не исполняют, есть статические og/twitter-теги по умолчанию в index.html.
import { useEffect } from "react";
import { SITE_URL } from "./seo";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useDocumentHead({ title, description, path, ogImage }: { title: string; description: string; path: string; ogImage?: string }) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    document.title = title;
    upsertMeta("name", "description", description);
    upsertLink("canonical", url);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:type", "website");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    if (ogImage) {
      upsertMeta("property", "og:image", ogImage);
      upsertMeta("name", "twitter:image", ogImage);
      upsertMeta("name", "twitter:card", "summary_large_image");
    }
  }, [title, description, path, ogImage]);
}
