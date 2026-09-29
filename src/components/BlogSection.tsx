// «Последние статьи» — общий раздел для гостевого лендинга (Landing.tsx) и дашборда (Dashboard.tsx),
// сам себе грузит данные (в отличие от большинства секций Dashboard, которые получают всё через
// пропсы) — эти две страницы иначе не разделяют слой загрузки данных. Ничего не рендерит, если
// опубликованных статей ещё нет вообще, чтобы пустой блог не оставлял дыру в вёрстке в день запуска.
import { useEffect, useState } from "react";
import { loadHomepageArticles, type BlogArticle } from "../lib/blog";
import { Icon, Reveal } from "./ui";
import type { View } from "./Header";

export default function BlogSection({ onNav }: { onNav: (v: View) => void }) {
  const [articles, setArticles] = useState<BlogArticle[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHomepageArticles(4).then((list) => {
      if (!cancelled) setArticles(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!articles || articles.length === 0) return null;

  return (
    <section className="mt-16">
      <Reveal>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">база знаний</p>
            <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Последние статьи</h2>
          </div>
          <button onClick={() => onNav({ name: "blog" })} className="link-slide hidden items-center gap-2 text-sm font-bold text-ink sm:flex">
            все статьи <Icon name="arrowR" size={16} />
          </button>
        </div>
      </Reveal>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {articles.map((a, i) => (
          <Reveal key={a.id} delay={i * 70}>
            <button onClick={() => onNav({ name: "blog-article", slug: a.slug })} className="sheet card-lift group flex h-full w-full flex-col overflow-hidden text-left">
              {a.coverImage && (
                <img
                  src={a.coverImage}
                  alt=""
                  loading="lazy"
                  // aspect-[40/21] = пропорция обложек (1200×630) — см. тот же комментарий в BlogList.tsx
                  className="aspect-[40/21] w-full border-b-2 border-ink object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              <div className="flex flex-1 flex-col p-4">
                {a.isPinned && <span className="mb-1.5 w-fit font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-blue">📌 закреплено</span>}
                <h3 className="font-display text-[14.5px] font-bold leading-snug">{a.title}</h3>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-ink2">{a.excerpt}</p>
                <span className="mt-3 flex items-center gap-1.5 text-[12.5px] font-extrabold text-blue">
                  Читать <Icon name="arrowR" size={14} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </button>
          </Reveal>
        ))}
      </div>

      <button onClick={() => onNav({ name: "blog" })} className="link-slide mt-5 flex items-center gap-2 text-sm font-bold text-ink sm:hidden">
        Все статьи <Icon name="arrowR" size={16} />
      </button>
    </section>
  );
}
