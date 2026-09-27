// Публичный список статей — /blog, доступен и гостям (SEO-трафик — весь смысл раздела). Текст
// статьи (не этот список) редактирует админ в AdminBlog.tsx.
import { useEffect, useState } from "react";
import { loadPublishedArticles, type BlogArticle } from "../lib/blog";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, Reveal } from "./ui";
import type { View } from "./Header";

export default function BlogList({ onNav }: { onNav: (v: View) => void }) {
  const [articles, setArticles] = useState<BlogArticle[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPublishedArticles().then((list) => {
      if (!cancelled) setArticles(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useDocumentHead({
    title: "База знаний — ЕГЭ·ПРО",
    description: "Статьи и разборы для подготовки к ЕГЭ: сравнения, гайды, объяснения — как эффективно готовиться и пользоваться платформой.",
    path: "/blog",
  });

  if (!articles) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="mt-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">база знаний</p>
        <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Статьи о подготовке к ЕГЭ</h1>
      </div>

      {articles.length === 0 ? (
        <p className="mt-10 text-[13.5px] text-ink2">Статей пока нет — загляни позже.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a, i) => (
            <Reveal key={a.id} delay={i * 60}>
              <button onClick={() => onNav({ name: "blog-article", slug: a.slug })} className="sheet card-lift group flex h-full w-full flex-col overflow-hidden text-left">
                {a.coverImage && (
                  <img src={a.coverImage} alt="" loading="lazy" className="h-36 w-full border-b-2 border-ink object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                )}
                <div className="flex flex-1 flex-col p-4">
                  {a.isPinned && <span className="mb-1.5 w-fit font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-blue">📌 закреплено</span>}
                  <h2 className="font-display text-[15px] font-bold leading-snug">{a.title}</h2>
                  <p className="mt-1.5 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-ink2">{a.excerpt}</p>
                  <div className="mt-3 flex items-center justify-between">
                    {a.publishedAt && <span className="font-mono text-[11px] text-ink2">{new Date(a.publishedAt).toLocaleDateString("ru-RU")}</span>}
                    <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-blue">
                      Читать <Icon name="arrowR" size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
