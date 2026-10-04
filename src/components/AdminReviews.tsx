// Модерация отзывов (docker/api/reviews.js → /admin/reviews). Публиковать можно только отзывы с оценкой
// 4–5 и согласием автора (статус «На модерации»); приватные (оценка 1–3 или без согласия) — только
// читаются, как обратная связь. Ответ команды показывается под опубликованным отзывом.
import { useCallback, useEffect, useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { REVIEW_STATUS_LABEL, loadAdminReviews, moderateAdminReview, type AdminReview, type AdminReviews, type ReviewStatus } from "../lib/reviews";
import { Stars } from "./ReviewsSection";
import { refreshAdminBadges } from "../lib/adminBadges";
import { useToast } from "./ui";

const FILTERS: ReviewStatus[] = ["pending", "approved", "private", "rejected"];

function ReviewRow({ r, onChanged }: { r: AdminReview; onChanged: () => void }) {
  const { push } = useToast();
  const [reply, setReply] = useState(r.adminReply ?? "");
  const [busy, setBusy] = useState(false);
  const canPublish = r.rating > 3 && r.consentPublic;

  const act = async (action: "approve" | "reject" | "unpublish" | "reply") => {
    setBusy(true);
    const res = await moderateAdminReview(r.id, action, action === "reply" ? reply : undefined);
    setBusy(false);
    if (res.error) return push(res.error, "err");
    push(action === "approve" ? "Опубликовано" : action === "reply" ? "Ответ сохранён" : "Готово", "ok");
    refreshAdminBadges();
    onChanged();
  };

  return (
    <li className="border-2 border-ink/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Stars value={r.rating} size={16} />
          <strong className="text-[13.5px]">{r.displayName}</strong>
          {r.subject && <span className="font-mono text-[11.5px] text-ink2">{SUBJECTS[r.subject as Subject]?.name ?? r.subject}</span>}
        </div>
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-blue">{REVIEW_STATUS_LABEL[r.status]}</span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink2">
        {r.email} · {new Date(r.updatedAt).toLocaleString("ru-RU")} · согласие на публикацию: {r.consentPublic ? "да" : "нет"}
      </p>
      <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed">{r.body}</p>

      <label className="mt-3 block">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Ответ команды (виден под опубликованным отзывом)</span>
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={800} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]" />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.status !== "approved" && (
          <button onClick={() => act("approve")} disabled={busy || !canPublish} title={canPublish ? "" : "Оценка 1–3 или нет согласия автора — публиковать нельзя"} className="btn btn-ink px-3.5 py-2 text-[12.5px] disabled:opacity-40">
            Опубликовать
          </button>
        )}
        {r.status === "approved" && (
          <button onClick={() => act("unpublish")} disabled={busy} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
            Снять с публикации
          </button>
        )}
        {r.status !== "rejected" && (
          <button onClick={() => act("reject")} disabled={busy} className="btn btn-ghost px-3.5 py-2 text-[12.5px] text-red">
            Отклонить
          </button>
        )}
        <button onClick={() => act("reply")} disabled={busy || reply.trim() === (r.adminReply ?? "")} className="btn btn-ghost px-3.5 py-2 text-[12.5px] disabled:opacity-40">
          Сохранить ответ
        </button>
      </div>
    </li>
  );
}

export default function AdminReviews() {
  const [filter, setFilter] = useState<ReviewStatus>("pending");
  const [data, setData] = useState<AdminReviews | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setData(await loadAdminReviews(filter));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return (
    <div>
      <p className="max-w-2xl text-[13px] leading-relaxed text-ink2">
        Отзывы пишут только ученики, прошедшие онбординг, диагностику и минимум 5 обращений к репетитору. На сайт попадают отзывы с оценкой 4–5 и согласием автора — после вашей проверки. Остальные видны только здесь как обратная связь. Блок на лендинге и в тарифах появляется, когда опубликовано хотя бы 3 отзыва.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Статус отзывов">
        {FILTERS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`rounded-sm border-2 px-3 py-1.5 text-[12.5px] font-bold transition ${filter === s ? "border-blue bg-blue text-white" : "border-ink/20 text-ink2 hover:text-ink"}`}
          >
            {REVIEW_STATUS_LABEL[s]}
            {data && <span className="ml-1.5 font-mono text-[11px] opacity-80">{data.counts[s]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      ) : !data ? (
        <p className="mt-6 text-[13px] text-red">Не удалось загрузить отзывы.</p>
      ) : data.reviews.length === 0 ? (
        <p className="mt-6 text-[13px] text-ink2">Здесь пока пусто.</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {data.reviews.map((r) => (
            <ReviewRow key={`${r.id}:${r.updatedAt}`} r={r} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}
