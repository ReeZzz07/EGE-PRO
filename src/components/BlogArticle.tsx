// Публичная страница статьи — /blog/:slug, доступна и гостям. RLS в blog_articles сама прячет
// черновики от не-админа (см. supabase/migrations/0032_blog_articles.sql) — несуществующий или
// неопубликованный slug здесь неотличимы, оба дают "статья не найдена".
import { useEffect, useMemo, useState } from "react";
import { loadArticleBySlug, loadPublishedArticles, markArticleRead, type BlogArticle as BlogArticleData } from "../lib/blog";
import { prepareArticleHtml } from "../lib/articleToc";
import { PAGE_SHELL } from "../lib/layout";
import { useDocumentHead } from "../lib/useDocumentHead";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";
import ArticleEngagement from "./ArticleEngagement";
import BlogSidebar from "./BlogSidebar";
import type { View } from "./Header";

export default function BlogArticle({ slug, onNav }: { slug: string; onNav: (v: View) => void }) {
  const { profile } = useAuth();
  const [data, setData] = useState<BlogArticleData | null | "not-found">(null);
  const [list, setList] = useState<BlogArticleData[]>([]);

  useEffect(() => {
    setData(null);
    let cancelled = false;
    loadArticleBySlug(slug).then((a) => {
      if (cancelled) return;
      setData(a ?? "not-found");
      // Счётчик в Header.tsx считает только опубликованные — отмечать черновик-предпросмотр
      // прочитанным незачем, он и так не входит в подсчёт.
      if (a?.isPublished && profile) markArticleRead(a.id, profile.id);
    });
    loadPublishedArticles().then((articles) => {
      if (!cancelled) setList(articles);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, profile?.id]);

  useDocumentHead({
    title: data && data !== "not-found" ? data.title : "База знаний — ЕГЭ·ПРО",
    description: data && data !== "not-found" ? data.excerpt : "Статьи и разборы для подготовки к ЕГЭ.",
    path: `/blog/${slug}`,
    ogImage: (data && data !== "not-found" && data.coverImage) || undefined,
  });

  const prepared = useMemo(() => {
    if (!data || data === "not-found") return { html: "", toc: [] };
    return prepareArticleHtml(data.content);
  }, [data]);

  if (data === null) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  if (data === "not-found") {
    return (
      <div className={`${PAGE_SHELL} py-20 text-center`}>
        <p className="font-display text-xl font-bold">Статья не найдена</p>
        <p className="mt-2 text-[13.5px] text-ink2">Возможно, её убрали или ссылка устарела.</p>
        <button onClick={() => onNav({ name: "blog" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">
          Ко всем статьям
        </button>
      </div>
    );
  }

  return (
    <div className={`${PAGE_SHELL} pb-20`}>
      <button onClick={() => onNav({ name: "blog" })} className="link-slide mt-8 flex items-center gap-1.5 text-[13px] font-bold text-ink2 hover:text-ink">
        <Icon name="arrowR" size={14} className="rotate-180" /> Ко всем статьям
      </button>

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_min(320px,32%)]">
        <div className="min-w-0">
          <div className="sheet overflow-hidden p-0">
            {/* aspect-[40/21] = пропорция обложек (1200×630) вместо фиксированной высоты — на узком
                экране высота сама пропорционально уменьшается, без лишней обрезки по бокам */}
            {data.coverImage && <img src={data.coverImage} alt="" className="aspect-[40/21] w-full border-b-2 border-ink object-cover" />}
            <div className="p-6 sm:p-8 lg:p-10">
              <h1 className="font-display text-xl font-bold sm:text-2xl lg:text-3xl">{data.title}</h1>
              {data.publishedAt && <p className="mt-1.5 font-mono text-[11.5px] text-ink2">{new Date(data.publishedAt).toLocaleDateString("ru-RU")}</p>}
              <div className="article-content mt-6 max-w-none text-[14px] sm:text-[15px]" dangerouslySetInnerHTML={{ __html: prepared.html }} />
            </div>
          </div>

          {/* просмотры, лайки, репосты и комментарии; у черновика (предпросмотр админа) блока нет */}
          <ArticleEngagement slug={data.slug} title={data.title} published={data.isPublished} onNav={onNav} />
        </div>

        <BlogSidebar articles={list} currentSlug={data.slug} currentCategory={data.category} toc={prepared.toc} onNav={onNav} />
      </div>
    </div>
  );
}
