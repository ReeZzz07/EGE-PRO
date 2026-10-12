// Под статьёй блога: «Просмотры», «Лайки», «Репост в соцсети», «Комментарии». Смотреть, лайкать, делиться и читать
// комментарии могут все (в том числе гости), писать комментарии — только вошедшие (гостю вместо формы — приглашение
// войти). Серверная часть — docker/api/blogEngagement.js. Для черновика (его нет среди опубликованных) блок не
// показывается.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { SITE_URL } from "../lib/seo";
import {
  COMMENT_MAX,
  SHARE_LABEL,
  loadEngagement,
  loadMoreComments,
  postComment,
  registerShare,
  registerView,
  removeComment,
  shareLink,
  toggleLike,
  type BlogComment,
  type EngagementStats,
  type ShareChannel,
} from "../lib/blogEngagement";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

const ZERO: EngagementStats = { views: 0, likes: 0, shares: 0, comments: 0, liked: false };
const nf = (n: number) => n.toLocaleString("ru-RU");
const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.8 5 6.2 5c2 0 3.5 1.1 4.3 2.4h3C14.3 6.1 15.8 5 17.8 5c3.4 0 5.3 3.4 3.8 6.8C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function Stat({ label, value, children }: { label: string; value: number; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-[96px] flex-1 flex-col border-2 border-ink/15 px-3 py-2.5">
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink2">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <span data-testid={`stat-${label}`} className="font-display text-xl font-black tabular-nums">{nf(value)}</span>
        {children}
      </span>
    </div>
  );
}

export default function ArticleEngagement({ slug, title, published, onNav }: { slug: string; title: string; published: boolean; onNav: (v: View) => void }) {
  const { profile } = useAuth();
  const { push } = useToast();
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const viewedSlug = useRef<string | null>(null);

  useEffect(() => {
    if (!published) return;
    let cancelled = false;
    setStats(null);
    setComments([]);
    // сначала засчитываем просмотр (один раз на открытие статьи, а не при каждом входе/выходе), потом читаем
    // счётчики — чтобы показанное число включало и этот заход
    const counted = viewedSlug.current === slug ? Promise.resolve(null) : registerView(slug);
    viewedSlug.current = slug;
    counted.then(() =>
      loadEngagement(slug).then((r) => {
        if (cancelled || !r) return;
        setStats(r.stats);
        setComments(r.comments);
        setNext(r.nextBeforeId);
      })
    );
    return () => {
      cancelled = true;
    };
    // при входе/выходе перезагружаем: у вошедшего свой лайк и свои комментарии с кнопкой «удалить»
  }, [slug, published, profile?.id]);

  if (!published || !stats) return null;

  const url = `${SITE_URL}/blog/${slug}`;
  const s = stats;

  const like = async () => {
    const before = s;
    // оптимистично: клик отзывается сразу, при ошибке возвращаем как было
    setStats({ ...s, liked: !s.liked, likes: s.likes + (s.liked ? -1 : 1) });
    const r = await toggleLike(slug);
    if (r.error || r.liked === undefined || r.likes === undefined) {
      setStats(before);
      push(r.error ?? "Не получилось поставить лайк", "err");
      return;
    }
    setStats((cur) => (cur ? { ...cur, liked: r.liked!, likes: r.likes! } : cur));
  };

  const share = async (channel: ShareChannel) => {
    if (channel === "copy") {
      try {
        await navigator.clipboard.writeText(url);
        push("Ссылка скопирована", "ok");
      } catch {
        push("Не получилось скопировать — выдели ссылку в адресной строке", "err");
        return;
      }
    } else {
      window.open(shareLink(channel, url, title), "_blank", "noopener,noreferrer");
    }
    const fresh = await registerShare(slug, channel);
    if (fresh) setStats((cur) => (cur ? { ...cur, shares: fresh.shares } : cur));
  };

  const send = async () => {
    setSending(true);
    setFormError(null);
    const r = await postComment(slug, text);
    setSending(false);
    if (r.error || !r.comment) return setFormError(r.error ?? "Не удалось отправить комментарий");
    setComments((c) => [r.comment!, ...c]);
    setStats((cur) => (cur && r.stats ? { ...cur, comments: r.stats.comments } : cur));
    setText("");
  };

  const remove = async (c: BlogComment) => {
    if (!window.confirm("Удалить комментарий?")) return;
    const r = await removeComment(c.id);
    if (r.error) return push(r.error, "err");
    setComments((list) => list.filter((x) => x.id !== c.id));
    setStats((cur) => (cur ? { ...cur, comments: Math.max(0, cur.comments - 1) } : cur));
  };

  const more = async () => {
    if (next === null) return;
    setLoadingMore(true);
    const r = await loadMoreComments(slug, next);
    setLoadingMore(false);
    if (!r) return push("Не удалось загрузить комментарии", "err");
    setComments((c) => [...c, ...r.comments]);
    setNext(r.nextBeforeId);
  };

  return (
    <section aria-label="Реакции и комментарии" className="mt-6">
      <div className="sheet p-5 sm:p-6">
        <div className="flex flex-wrap gap-3">
          <Stat label="Просмотры" value={s.views} />
          <Stat label="Лайки" value={s.likes}>
            <button
              onClick={like}
              aria-pressed={s.liked}
              aria-label={s.liked ? "Убрать лайк" : "Поставить лайк"}
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${s.liked ? "border-red bg-red/10 text-red" : "border-ink/30 text-ink2 hover:border-red hover:text-red"}`}
            >
              <Heart filled={s.liked} />
            </button>
          </Stat>
          <Stat label="Репост в соцсети" value={s.shares} />
          <Stat label="Комментарии" value={s.comments} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold text-ink2">Поделиться:</span>
          {(Object.keys(SHARE_LABEL) as Array<keyof typeof SHARE_LABEL>).map((ch) => (
            <button key={ch} onClick={() => share(ch)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
              {SHARE_LABEL[ch]}
            </button>
          ))}
          <button onClick={() => share("copy")} className="btn btn-ghost px-3 py-1.5 text-[12px]">
            <Icon name="link" size={13} /> Скопировать ссылку
          </button>
        </div>
      </div>

      <div className="sheet mt-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Комментарии{s.comments > 0 ? ` · ${nf(s.comments)}` : ""}</h2>

        {profile ? (
          <div className="mt-4">
            <label htmlFor="comment-text" className="sr-only">Ваш комментарий</label>
            <textarea
              id="comment-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={COMMENT_MAX}
              rows={3}
              placeholder="Поделись мыслью или задай вопрос по статье"
              className="input-blank w-full resize-y rounded-sm px-3.5 py-2.5 text-[13.5px]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-ink2">{text.length} / {COMMENT_MAX}. Ссылки и контакты в комментариях не публикуются.</span>
              <button onClick={send} disabled={sending || text.trim().length < 2} className="btn btn-blue px-5 py-2 text-[13px]">
                {sending ? "Отправляем…" : "Отправить"}
              </button>
            </div>
            {formError && <p role="alert" className="mt-2 text-[12.5px] font-bold text-red">{formError}</p>}
          </div>
        ) : (
          <div className="mt-4 border-2 border-dashed border-ink/25 p-4">
            <p className="text-[13.5px] leading-relaxed text-ink2">Читать комментарии может любой, а оставить свой могут только зарегистрированные пользователи.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => onNav({ name: "auth", mode: "login" })} className="btn btn-ink px-4 py-2 text-[12.5px]">Войти</button>
              <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-ghost px-4 py-2 text-[12.5px]">Зарегистрироваться</button>
            </div>
          </div>
        )}

        {comments.length === 0 ? (
          <p className="mt-5 text-[13.5px] text-ink2">Комментариев пока нет. Можно стать первым.</p>
        ) : (
          <ul className="mt-5 space-y-4">
            {comments.map((c) => (
              <li key={c.id} className="border-l-4 border-ink/15 pl-4" data-testid="comment">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[13.5px] font-bold">{c.author}</span>
                  {c.staff && <span className="rounded-sm bg-hl px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider">редакция</span>}
                  <span className="font-mono text-[11px] text-ink2">{when(c.createdAt)}</span>
                  {(c.mine || profile?.isAdmin) && (
                    <button onClick={() => remove(c)} className="link-slide ml-auto text-[12px] font-bold text-ink2 hover:text-red">
                      Удалить
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink/90">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {next !== null && (
          <button onClick={more} disabled={loadingMore} className="btn btn-ghost mt-5 px-4 py-2 text-[12.5px]">
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </button>
        )}
      </div>
    </section>
  );
}
