// Сайдбар базы знаний: поиск, оглавление статьи, список статей, быстрые ссылки.
import { useMemo, useState } from "react";
import type { BlogArticle } from "../lib/blog";
import type { ArticleTocItem } from "../lib/articleToc";
import { Icon } from "./ui";
import type { View } from "./Header";

type Props = {
  articles: BlogArticle[];
  currentSlug?: string;
  toc?: ArticleTocItem[];
  onNav: (v: View) => void;
  /** Фильтр списка на странице /blog — если передан, поиск живёт снаружи */
  query?: string;
  onQueryChange?: (q: string) => void;
};

export default function BlogSidebar({ articles, currentSlug, toc = [], onNav, query, onQueryChange }: Props) {
  const [localQuery, setLocalQuery] = useState("");
  const q = (onQueryChange ? query ?? "" : localQuery).trim().toLowerCase();
  const setQ = (v: string) => (onQueryChange ? onQueryChange(v) : setLocalQuery(v));

  const pinned = useMemo(() => articles.filter((a) => a.isPinned), [articles]);
  const filtered = useMemo(() => {
    if (!q) return articles;
    return articles.filter((a) => a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q));
  }, [articles, q]);

  const others = useMemo(
    () => filtered.filter((a) => a.slug !== currentSlug).slice(0, currentSlug ? 12 : 40),
    [filtered, currentSlug]
  );

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

      {pinned.length > 0 && !currentSlug && (
        <nav className="sheet border-blue/40 p-4" aria-label="Закреплённые">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-blue">закреплено</p>
          <ul className="mt-3 space-y-2">
            {pinned.map((a) => (
              <li key={a.id}>
                <button onClick={() => onNav({ name: "blog-article", slug: a.slug })} className="link-slide text-left text-[13px] font-bold leading-snug hover:text-blue">
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <nav className="sheet p-4" aria-label="Статьи">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            {currentSlug ? "другие статьи" : "все статьи"}
          </p>
          {currentSlug && (
            <button onClick={() => onNav({ name: "blog" })} className="link-slide font-mono text-[11px] font-bold text-blue">
              ко всем
            </button>
          )}
        </div>
        {others.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-ink2">{q ? "Ничего не нашлось." : "Пока пусто."}</p>
        ) : (
          <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {others.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => onNav({ name: "blog-article", slug: a.slug })}
                  className={`link-slide block w-full text-left text-[12.5px] leading-snug ${
                    a.slug === currentSlug ? "font-bold text-blue" : "text-ink2 hover:text-ink"
                  }`}
                >
                  {a.isPinned ? "📌 " : ""}
                  {a.title}
                </button>
              </li>
            ))}
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
