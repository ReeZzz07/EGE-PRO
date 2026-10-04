// Страница «Мой отзыв». Пока допуск не выполнен — показывает прогресс по трём условиям (онбординг,
// диагностика, 5 обращений к репетитору), иначе — форму. Допуск проверяет сервер при каждом сохранении
// (docker/api/reviews.js), здесь он только рисуется. Оценки 1–3 и отзывы без согласия на публикацию
// публично не показываются — видны только команде; об этом форма говорит сразу, а не после отправки.
import { useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import {
  MAX_PRIVATE_RATING, MAX_REVIEW_BODY, MIN_REVIEW_BODY, REVIEW_STATUS_LABEL,
  deleteMyReview, saveMyReview, useMyReviewState,
  type MyReview, type MyReviewState,
} from "../lib/reviews";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

const ID = "review-field";

export function StarsInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Оценка" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} из 5`}
          onClick={() => onChange(n)}
          className={`p-1 transition ${n <= value ? "text-amber" : "text-ink/25 hover:text-amber/60"}`}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill={n <= value ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function Progress({ state, onNav }: { state: MyReviewState; onNav: (v: View) => void }) {
  const e = state.eligibility;
  const items: { done: boolean; label: string; hint?: string; go?: View }[] = [
    { done: e.onboarding, label: "Онбординг", go: { name: "onboarding" } },
    { done: e.diagnostic, label: "Диагностика", go: { name: "diagnostic" } },
    { done: e.aiMessages >= e.required, label: `Вопросы ИИ-репетитору: ${Math.min(e.aiMessages, e.required)} из ${e.required}`, go: { name: "tutor" } },
  ];
  return (
    <div className="sheet p-5 sm:p-6">
      <p className="font-display text-lg font-black">Отзыв откроется, когда ты попробуешь сервис</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">
        Нам важны отзывы тех, кто реально занимался: пройди три шага — и здесь появится форма.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink/10 px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-[13.5px] font-bold">
              <Icon name={it.done ? "check" : "target"} size={15} className={it.done ? "text-green" : "text-ink2"} />
              <span className={it.done ? "text-ink2 line-through" : ""}>{it.label}</span>
            </span>
            {!it.done && it.go && (
              <button onClick={() => onNav(it.go!)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                Перейти
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusNote({ review }: { review: MyReview }) {
  const tone = review.status === "approved" ? "border-green bg-green/10" : review.status === "rejected" ? "border-red bg-red/10" : "border-blue bg-blue/5";
  const text =
    review.status === "approved"
      ? "Отзыв опубликован на сайте. Спасибо!"
      : review.status === "pending"
        ? "Отзыв на модерации — после проверки он появится на сайте. Правка снова отправит его на проверку."
        : review.status === "rejected"
          ? "Отзыв не прошёл модерацию и не публикуется. Можно переписать его и отправить заново."
          : review.rating <= MAX_PRIVATE_RATING
            ? "Спасибо за честность! Отзыв с такой оценкой на сайте не публикуется — его видит только команда, и мы разберёмся, что поправить."
            : "Отзыв виден только команде — публиковать его на сайте ты не разрешил(а).";
  return (
    <div className={`border-l-4 px-4 py-3 text-[13px] leading-relaxed text-ink2 ${tone}`}>
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink">{REVIEW_STATUS_LABEL[review.status]}</span>
      <p className="mt-1">{text}</p>
      {review.adminReply && (
        <p className="mt-2 text-ink">
          <strong>Ответ команды:</strong> {review.adminReply}
        </p>
      )}
    </div>
  );
}

function Form({ state, onSaved }: { state: MyReviewState; onSaved: () => Promise<void> }) {
  const { push } = useToast();
  const existing = state.review;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? state.defaultName);
  const [consent, setConsent] = useState(existing?.consentPublic ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lowRating = rating > 0 && rating <= MAX_PRIVATE_RATING;
  const bodyLen = body.trim().length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (rating < 1) return setError("Поставь оценку звёздами.");
    if (bodyLen < MIN_REVIEW_BODY) return setError(`Напиши хотя бы ${MIN_REVIEW_BODY} символов — пару предложений о том, что помогло или чего не хватило.`);
    setBusy(true);
    const res = await saveMyReview({ rating, body: body.trim(), subject: subject || null, displayName: displayName.trim(), consentPublic: consent && !lowRating });
    setBusy(false);
    if (res.error) return setError(res.error);
    push(existing ? "Отзыв обновлён" : "Спасибо за отзыв!", "ok");
    await onSaved();
  };

  const remove = async () => {
    if (!window.confirm("Удалить отзыв?")) return;
    setBusy(true);
    const res = await deleteMyReview();
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Отзыв удалён", "ok");
    setRating(0);
    setBody("");
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="sheet space-y-5 p-5 sm:p-6" noValidate>
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">оценка</p>
        <div className="mt-1.5">
          <StarsInput value={rating} onChange={setRating} />
        </div>
        {lowRating && (
          <p className="anim-rise mt-2 text-[12.5px] leading-relaxed text-ink2">
            Отзывы с оценкой 1–3 на сайте не публикуются: их видит только команда — нам важно понять, что исправить.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${ID}-body`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
          твой отзыв
        </label>
        <textarea
          id={`${ID}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={MAX_REVIEW_BODY}
          placeholder="Что помогло в подготовке? Чего не хватило? Чем пользовался(ась) — диагностикой, планом, репетитором, пробниками?"
          className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-3 text-[14px] leading-relaxed"
        />
        <p className={`mt-1 text-right font-mono text-[11px] ${bodyLen < MIN_REVIEW_BODY ? "text-ink2" : "text-green"}`}>
          {bodyLen} / {MAX_REVIEW_BODY} · минимум {MIN_REVIEW_BODY}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ID}-name`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
            как подписать
          </label>
          <input
            id={`${ID}-name`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Анна К."
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[14px]"
          />
          <p className="mt-1 text-[11.5px] text-ink2">Имя и первая буква фамилии или ник — фамилию целиком не пиши.</p>
        </div>
        {state.subjects.length > 0 && (
          <div>
            <label htmlFor={`${ID}-subject`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
              предмет
            </label>
            <select id={`${ID}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2.5 text-[14px]">
              <option value="">Не указывать</option>
              {state.subjects.map((s) => (
                <option key={s} value={s}>
                  {SUBJECTS[s as Subject]?.name ?? s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <label className={`flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed ${lowRating ? "opacity-50" : ""}`}>
        <input type="checkbox" checked={consent && !lowRating} disabled={lowRating} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-blue" />
        <span>
          Разрешаю опубликовать отзыв на сайте с этой подписью. После проверки модератором он появится на главной и на странице тарифов; отозвать согласие можно в любой момент — удалив отзыв здесь.
        </span>
      </label>

      {error && (
        <p role="alert" className="anim-rise flex items-start gap-2 text-[13px] font-bold text-red">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn btn-ink px-5 py-2.5 text-[13px]">
          {busy ? "Сохраняем…" : existing ? "Сохранить изменения" : "Отправить отзыв"}
        </button>
        {existing && (
          <button type="button" onClick={remove} disabled={busy} className="btn btn-ghost px-4 py-2.5 text-[13px] text-red">
            Удалить отзыв
          </button>
        )}
      </div>
    </form>
  );
}

export default function ReviewView({ onNav }: { onNav: (v: View) => void }) {
  const { state, loading, reload } = useMyReviewState();

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="mt-8 sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">отзыв</p>
        <h1 className="font-display mt-2 text-2xl font-black sm:text-3xl">Как тебе ЕГЭ·ПРО?</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">Честный отзыв помогает нам улучшать сервис, а другим ученикам — понять, подойдёт ли он им.</p>
      </div>

      <div className="mt-6 space-y-4">
        {loading && <p className="py-10 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>}
        {!loading && !state && <p className="text-[13.5px] text-ink2">Не удалось загрузить данные. Обнови страницу и попробуй ещё раз.</p>}
        {state && state.eligibility.isAdmin && <p className="text-[13.5px] text-ink2">Администраторы отзывы не оставляют — их отзывы смотрят в разделе «Админка → Отзывы».</p>}
        {state && !state.eligibility.isAdmin && !state.eligibility.eligible && !state.review && <Progress state={state} onNav={onNav} />}
        {state && !state.eligibility.isAdmin && (state.eligibility.eligible || state.review) && (
          <>
            {state.review && <StatusNote review={state.review} />}
            <Form
              key={state.review?.updatedAt ?? "new"}
              state={state}
              onSaved={reload}
            />
          </>
        )}
      </div>
    </div>
  );
}
