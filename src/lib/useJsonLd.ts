// Один JSON-LD на публичную страницу (FAQPage и т.п.). Текст в разметке должен совпадать с видимым FAQ —
// иначе AEO/сниппет и аудит ругаются. Не плодить второй FAQPage на той же странице.
import { useEffect } from "react";

export type FaqLdItem = { q: string; a: string };

export function faqPageLd(items: FaqLdItem[]) {
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** Вставляет/обновляет <script type="application/ld+json" id=...>. data=null — снимает тег. */
export function useJsonLd(id: string, data: object | null) {
  const payload = data ? JSON.stringify(data) : "";
  useEffect(() => {
    const sid = `jsonld-${id}`;
    let el = document.getElementById(sid) as HTMLScriptElement | null;
    if (!payload) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = sid;
      document.head.appendChild(el);
    }
    el.text = payload;
    return () => {
      el?.remove();
    };
  }, [id, payload]);
}
