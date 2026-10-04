// Публичные отзывы — на лендинге и странице тарифов. Берём только опубликованные (прошедшие
// модерацию), блок скрыт, пока их меньше MIN_PUBLIC_REVIEWS: два отзыва выглядят хуже, чем ни одного.
import { SUBJECTS, type Subject } from "../data/tasks";
import { plural } from "../lib/utils";
import { usePublicReviews, type PublicReview } from "../lib/reviews";

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span role="img" aria-label={`Оценка ${value} из 5`} className="inline-flex gap-0.5 text-amber">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 24 24" fill={n <= value ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
        </svg>
      ))}
    </span>
  );
}

function ReviewCard({ r }: { r: PublicReview }) {
  const subject = r.subject ? SUBJECTS[r.subject as Subject]?.name : null;
  return (
    <figure className="sheet flex h-full flex-col p-5">
      <Stars value={r.rating} />
      <blockquote className="mt-3 flex-1 whitespace-pre-line text-[13.5px] leading-relaxed text-ink/90">{r.body}</blockquote>
      <figcaption className="mt-4 font-mono text-[11.5px] text-ink2">
        <strong className="text-ink">{r.displayName}</strong>
        {subject && <> · {subject}</>}
      </figcaption>
      {r.adminReply && (
        <p className="mt-3 border-l-4 border-blue bg-blue/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          <strong className="text-ink">Ответ команды:</strong> {r.adminReply}
        </p>
      )}
    </figure>
  );
}

export default function ReviewsSection({ limit = 6, eyebrow = "отзывы", title = "Что говорят ученики", className = "mt-16" }: { limit?: number; eyebrow?: string; title?: string; className?: string }) {
  const data = usePublicReviews(limit);
  if (!data) return null;
  return (
    <section className={className} aria-labelledby="reviews-title">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">{eyebrow}</p>
      <h2 id="reviews-title" className="font-display mt-1 text-2xl font-black sm:text-3xl">
        {title}
      </h2>
      {data.average != null && (
        <p className="mt-1.5 flex items-center gap-2 font-mono text-[12px] text-ink2">
          <Stars value={Math.round(data.average)} /> {data.average.toFixed(1).replace(".", ",")} · {data.count} {plural(data.count, "отзыв", "отзыва", "отзывов")}
        </p>
      )}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.reviews.map((r) => (
          <ReviewCard key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}
