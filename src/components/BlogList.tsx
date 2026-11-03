// Публичный список статей — /blog, доступен и гостям (SEO-трафик — весь смысл раздела). Текст
// статьи (не этот список) редактирует админ в AdminBlog.tsx.
import { useEffect, useMemo, useState } from "react";
import { loadPublishedArticles, type BlogArticle } from "../lib/blog";
import { loadAllEngagement, type EngagementStats } from "../lib/blogEngagement";
import { PAGE_SHELL } from "../lib/layout";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, Reveal } from "./ui";
import BlogSidebar from "./BlogSidebar";
import type { View } from "./Header";

export default function BlogList({ onNav }: { onNav: (v: View) => void }) {
  const [articles, setArticles] = useState<BlogArticle[] | null>(null);
  const [stats, setStats] = useState<Record<string, Omit<EngagementStats, "liked">>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadPublishedArticles().then((list) => {
      if (!cancelled) setArticles(list);
    });
    // счётчики — отдельным запросом: список не ждёт их, а при сбое карточки просто без цифр
    loadAllEngagement().then((s) => {
      if (!cancelled) setStats(s);
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

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!articles) return [];
    if (!q) return articles;
    return articles.filter((a) => a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q));
  }, [articles, q]);

  if (!articles) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className={`${PAGE_SHELL} pb-20`}>
      <div className="mt-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">база знаний</p>
        <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Статьи о подготовке к ЕГЭ</h1>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_min(320px,32%)]">
        <div>
          {articles.length === 0 ? (
            <p className="text-[13.5px] text-ink2">Статей пока нет — загляни позже.</p>
          ) : visible.length === 0 ? (
            <p className="text-[13.5px] text-ink2">По запросу «{query.trim()}» ничего не нашлось.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((a, i) => (
                <Reveal key={a.id} delay={i * 60}>
                  <button onClick={() => onNav({ name: "blog-article", slug: a.slug })} className="sheet card-lift group flex h-full w-full flex-col overflow-hidden text-left">
                    {a.coverImage && (
                      <img
                        src={a.coverImage}
                        alt=""
                        loading="lazy"
                        // aspect-[40/21] — ровно пропорция обложек (1200×630), а не фиксированная высота:
                        // на узком экране карточка становится уже, и object-cover с фиксированным h-*
                        // обрезал верх/низ куда сильнее, чем на десктопе, где соотношение сторон другое.
                        className="aspect-[40/21] w-full border-b-2 border-ink object-cover"
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      {a.isPinned && <span className="mb-1.5 w-fit font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-blue">📌 закреплено</span>}
                      <h2 className="font-display text-[15px] font-bold leading-snug">{a.title}</h2>
                      <p className="mt-1.5 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-ink2">{a.excerpt}</p>
                      {stats[a.slug] && (
                        <p data-testid={`counters-${a.slug}`} className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-ink2">
                          <span title="Просмотры" className="flex items-center gap-1"><Icon name="eye" size={12} /> {stats[a.slug].views.toLocaleString("ru-RU")}</span>
                          <span title="Лайки">♥ {stats[a.slug].likes.toLocaleString("ru-RU")}</span>
                          <span title="Комментарии" className="flex items-center gap-1"><Icon name="chat" size={12} /> {stats[a.slug].comments.toLocaleString("ru-RU")}</span>
                        </p>
                      )}
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

        <BlogSidebar articles={articles} onNav={onNav} query={query} onQueryChange={setQuery} />
      </div>
    </div>
  );
}
