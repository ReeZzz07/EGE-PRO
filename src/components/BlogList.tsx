// Публичный список статей — /blog, доступен и гостям (SEO-трафик — весь смысл раздела). Текст
// статьи (не этот список) редактирует админ в AdminBlog.tsx. Lead + FAQ = тот же blogIndex.json, что bot (AEO).
import { useEffect, useMemo, useState } from "react";
import { loadPublishedArticles, type BlogArticle } from "../lib/blog";
import { blogCategoryLabel, isBlogCategoryId, type BlogCategoryId } from "../lib/blogCategories";
import { loadAllEngagement, type EngagementStats } from "../lib/blogEngagement";
import { PAGE_SHELL } from "../lib/layout";
import { useDocumentHead } from "../lib/useDocumentHead";
import { faqPageLd, useJsonLd } from "../lib/useJsonLd";
import blogIndex from "../../docker/api/content/blogIndex.json";
import { Icon, Reveal } from "./ui";
import BlogSidebar from "./BlogSidebar";
import FaqAccordion from "./FaqAccordion";
import type { View } from "./Header";

const BLOG_FAQ = Array.isArray(blogIndex.faq) ? blogIndex.faq : [];

export default function BlogList({ onNav, category: categoryProp }: { onNav: (v: View) => void; category?: string }) {
  const [articles, setArticles] = useState<BlogArticle[] | null>(null);
  const [stats, setStats] = useState<Record<string, Omit<EngagementStats, "liked">>>({});
  const [query, setQuery] = useState("");
  const category: BlogCategoryId | null = isBlogCategoryId(categoryProp) ? categoryProp : null;

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
    title: category ? `${blogCategoryLabel(category)} — База знаний — ЕГЭ·ПРО` : blogIndex.seo.title,
    description: blogIndex.seo.description,
    path: category ? `/blog?cat=${category}` : "/blog",
  });
  // Один FAQPage на страницу; текст = видимый FaqAccordion (тот же blogIndex.json, что bot HTML).
  useJsonLd("blog-faq", faqPageLd(BLOG_FAQ));

  const setCategory = (id: BlogCategoryId | null) => {
    onNav(id ? { name: "blog", category: id } : { name: "blog" });
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!articles) return [];
    return articles.filter((a) => {
      if (category && a.category !== category) return false;
      if (!q) return true;
      return a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q);
    });
  }, [articles, q, category]);

  if (!articles) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className={`${PAGE_SHELL} pb-20`}>
      <div className="mt-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">база знаний</p>
        <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">
          {category ? blogCategoryLabel(category) : blogIndex.h1}
        </h1>
        {!category && <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink2">{blogIndex.intro}</p>}
        {category && (
          <button type="button" onClick={() => setCategory(null)} className="link-slide mt-2 text-[13px] font-bold text-ink2 hover:text-ink">
            ← все рубрики
          </button>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_min(320px,32%)]">
        <div>
          {articles.length === 0 ? (
            <p className="text-[13.5px] text-ink2">Статей пока нет — загляни позже.</p>
          ) : visible.length === 0 ? (
            <p className="text-[13.5px] text-ink2">
              {q ? `По запросу «${query.trim()}» ничего не нашлось.` : "В этой рубрике пока нет статей."}
            </p>
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
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        {a.isPinned && <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-blue">📌 закреплено</span>}
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink2">{blogCategoryLabel(a.category)}</span>
                      </div>
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

          {!category && BLOG_FAQ.length > 0 && (
            <section className="mt-12 max-w-3xl" data-testid="blog-faq">
              <h2 className="font-display text-xl font-black">{blogIndex.faqTitle}</h2>
              <FaqAccordion items={BLOG_FAQ} />
            </section>
          )}
        </div>

        <BlogSidebar
          articles={articles}
          onNav={onNav}
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
        />
      </div>
    </div>
  );
}
