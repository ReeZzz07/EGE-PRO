// Сайдбар базы знаний: поиск, оглавление статьи, рубрики (не простыня названий), быстрые ссылки.
import { useMemo, useState } from "react";
import type { BlogArticle } from "../lib/blog";
import {
  BLOG_CATEGORIES,
  blogCategoryLabel,
  isBlogCategoryId,
  type BlogCategoryId,
} from "../lib/blogCategories";
import type { ArticleTocItem } from "../lib/articleToc";
import { Icon } from "./ui";
import type { View } from "./Header";

type Props = {
  articles: BlogArticle[];
  currentSlug?: string;
  currentCategory?: BlogCategoryId | null;
  toc?: ArticleTocItem[];
  onNav: (v: View) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Фильтр рубрики на /blog; на странице статьи — переход на /blog?cat=… */
  category?: BlogCategoryId | null;
  onCategoryChange?: (id: BlogCategoryId | null) => void;
};

export default function BlogSidebar({
  articles,
  currentSlug,
  currentCategory = null,
  toc = [],
  onNav,
  query,
  onQueryChange,
  category = null,
  onCategoryChange,
}: Props) {
  const [localQuery, setLocalQuery] = useState("");
  const q = (onQueryChange ? query ?? "" : localQuery).trim().toLowerCase();
  const setQ = (v: string) => (onQueryChange ? onQueryChange(v) : setLocalQuery(v));

  const counts = useMemo(() => {
    const map = new Map<BlogCategoryId, number>();
    for (const a of articles) {
      map.set(a.category, (map.get(a.category) ?? 0) + 1);
    }
    return map;
  }, [articles]);

  const categories = useMemo(
    () => BLOG_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0 || c.id === category),
    [counts, category]
  );

  const selectCategory = (id: BlogCategoryId | null) => {
    if (onCategoryChange) {
      onCategoryChange(id);
      return;
    }
    onNav(id ? { name: "blog", category: id } : { name: "blog" });
  };

  return (
    <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" data-testid="blog-sidebar">
      <div className="sheet p-4">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">поиск</span>
          <input
            type="search"
            value={onQueryChange ? query ?? "" : localQuery}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Название или тема…"
            className="input-blank mt-2 w-full rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
        {q && !onQueryChange && (
          <p className="mt-2 text-[12px] text-ink2">Поиск фильтрует список на странице «База знаний».</p>
        )}
      </div>

      {toc.length > 0 && (
        <nav className="sheet p-4" aria-label="Оглавление статьи">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">в этой статье</p>
          <ul className="mt-3 space-y-1.5">
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`link-slide block text-[12.5px] leading-snug text-ink2 hover:text-ink ${item.level === 3 ? "pl-3" : "font-bold text-ink"}`}
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {currentSlug && currentCategory && isBlogCategoryId(currentCategory) && (
        <div className="sheet border-blue/30 p-4">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">рубрика статьи</p>
          <button
            type="button"
            onClick={() => selectCategory(currentCategory)}
            className="link-slide mt-2 text-left text-[13.5px] font-bold text-blue"
          >
            {blogCategoryLabel(currentCategory)}
          </button>
        </div>
      )}

      <nav className="sheet p-4" aria-label="Рубрики">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">рубрики</p>
          {(category || currentSlug) && (
            <button type="button" onClick={() => selectCategory(null)} className="link-slide font-mono text-[11px] font-bold text-blue">
              все
            </button>
          )}
        </div>
        {categories.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-ink2">Пока пусто.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {categories.map((c) => {
              const n = counts.get(c.id) ?? 0;
              const active = category === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectCategory(active ? null : c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] transition ${
                      active ? "bg-blue text-white" : "text-ink2 hover:bg-ink/5 hover:text-ink"
                    }`}
                    aria-pressed={active}
                  >
                    <span className="font-bold leading-snug">{c.label}</span>
                    <span className={`shrink-0 font-mono text-[11px] ${active ? "text-white/80" : "text-ink2"}`}>{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="sheet p-4">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">быстрые ссылки</p>
        <ul className="mt-3 space-y-2 text-[12.5px]">
          {[
            { label: "Бесплатная диагностика", view: { name: "diagnostic" } as View },
            { label: "Тарифы", view: { name: "tariffs" } as View },
            { label: "Родителям", view: { name: "parents" } as View },
            { label: "Контакты", view: { name: "contacts" } as View },
          ].map((x) => (
            <li key={x.label}>
              <button onClick={() => onNav(x.view)} className="link-slide flex items-center gap-1.5 font-bold text-ink2 hover:text-ink">
                <Icon name="arrowR" size={12} /> {x.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
