// useDocumentHead — единственный источник <title>/meta для четырёх публичных страниц (см.
// lib/routes.ts). Главное поведение, которое стоит держать под тестом: noindex (юридические
// документы — не для поисковой выдачи, см. LegalDoc.tsx/lib/legal.ts) реально проставляется в
// meta[robots], а повторный вызов апдейтит существующие теги вместо дублирования новых в <head>.
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentHead } from "./useDocumentHead";

function metaContent(attr: "name" | "property", key: string): string | null {
  return document.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? null;
}

afterEach(() => {
  document.title = "";
  document.head.querySelectorAll("meta, link").forEach((el) => el.remove());
});

describe("useDocumentHead", () => {
  it("проставляет title, description, robots (index по умолчанию) и canonical", () => {
    renderHook(() => useDocumentHead({ title: "Заголовок", description: "Описание", path: "/tariffs" }));
    expect(document.title).toBe("Заголовок");
    expect(metaContent("name", "description")).toBe("Описание");
    expect(metaContent("name", "robots")).toBe("index, follow");
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/tariffs$/);
  });

  it("noindex:true — robots=noindex, follow (не убирает follow — ссылки всё равно обходимы)", () => {
    renderHook(() => useDocumentHead({ title: "Оферта", description: "Д", path: "/oferta", noindex: true }));
    expect(metaContent("name", "robots")).toBe("noindex, follow");
  });

  it("og:image не задан — og:image/twitter:image/twitter:card не проставляются вовсе", () => {
    renderHook(() => useDocumentHead({ title: "T", description: "D", path: "/" }));
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull();
  });

  it("og:image задан — og:image/twitter:image/twitter:card проставляются", () => {
    renderHook(() => useDocumentHead({ title: "T", description: "D", path: "/", ogImage: "https://x/img.png" }));
    expect(metaContent("property", "og:image")).toBe("https://x/img.png");
    expect(metaContent("name", "twitter:image")).toBe("https://x/img.png");
    expect(metaContent("name", "twitter:card")).toBe("summary_large_image");
  });

  it("повторный вызов с другими данными — обновляет существующие теги, не плодит дубликаты в <head>", () => {
    const { rerender } = renderHook((props) => useDocumentHead(props), { initialProps: { title: "Первый", description: "D1", path: "/" } });
    rerender({ title: "Второй", description: "D2", path: "/" });
    expect(document.title).toBe("Второй");
    expect(metaContent("name", "description")).toBe("D2");
    expect(document.querySelectorAll('meta[name="description"]').length).toBe(1);
  });
});
