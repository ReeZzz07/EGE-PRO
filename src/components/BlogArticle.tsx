// Публичная страница статьи — /blog/:slug, доступна и гостям. RLS в blog_articles сама прячет
// черновики от не-админа (см. supabase/migrations/0032_blog_articles.sql) — несуществующий или
// неопубликованный slug здесь неотличимы, оба дают "статья не найдена".
import { useEffect, useState } from "react";
import { loadArticleBySlug, sanitizeArticleHtml, type BlogArticle as BlogArticleData } from "../lib/blog";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon } from "./ui";
import type { View } from "./Header";

export default function BlogArticle({ slug, onNav }: { slug: string; onNav: (v: View) => void }) {
  const [data, setData] = useState<BlogArticleData | null | "not-found">(null);

  useEffect(() => {
    setData(null);
    let cancelled = false;
    loadArticleBySlug(slug).then((a) => {
      if (!cancelled) setData(a ?? "not-found");
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useDocumentHead({
    title: data && data !== "not-found" ? data.title : "База знаний — ЕГЭ·ПРО",
    description: data && data !== "not-found" ? data.excerpt : "Статьи и разборы для подготовки к ЕГЭ.",
    path: `/blog/${slug}`,
    ogImage: (data && data !== "not-found" && data.coverImage) || undefined,
  });

  if (data === null) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  if (data === "not-found") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-display text-xl font-bold">Статья не найдена</p>
        <p className="mt-2 text-[13.5px] text-ink2">Возможно, её убрали или ссылка устарела.</p>
        <button onClick={() => onNav({ name: "blog" })} className="btn btn-ink mt-6 px-5 py-2.5 text-sm">
          Ко всем статьям
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <button onClick={() => onNav({ name: "blog" })} className="link-slide mt-8 flex items-center gap-1.5 text-[13px] font-bold text-ink2 hover:text-ink">
        <Icon name="arrowR" size={14} className="rotate-180" /> Ко всем статьям
      </button>

      <div className="sheet mt-5 overflow-hidden p-0">
        {data.coverImage && <img src={data.coverImage} alt="" className="h-56 w-full border-b-2 border-ink object-cover sm:h-72" />}
        <div className="p-6 sm:p-8">
          <h1 className="font-display text-xl font-bold sm:text-2xl">{data.title}</h1>
          {data.publishedAt && <p className="mt-1.5 font-mono text-[11.5px] text-ink2">{new Date(data.publishedAt).toLocaleDateString("ru-RU")}</p>}
          <div className="article-content mt-6 text-[13.5px]" dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(data.content) }} />
        </div>
      </div>
    </div>
  );
}
