// Отзывы о сервисе — клиент для docker/api/reviews.js. Допуск (онбординг + диагностика + 5 обращений к
// репетитору) всегда проверяет сервер; здесь только загрузка состояния и сохранение.
import { useCallback, useEffect, useState } from "react";
import { apiFetch, isSupabaseConfigured } from "./supabase";
import { useAuth } from "./auth";

export const MIN_REVIEW_BODY = 30;
export const MAX_REVIEW_BODY = 1500;
/** Оценки не выше этой публично не показываются — видны только команде */
export const MAX_PRIVATE_RATING = 3;
/** Публичный блок отзывов показываем, только когда их набралось хотя бы столько */
export const MIN_PUBLIC_REVIEWS = 3;

export type ReviewStatus = "private" | "pending" | "approved" | "rejected";

export interface ReviewEligibility {
  eligible: boolean;
  onboarding: boolean;
  diagnostic: boolean;
  aiMessages: number;
  required: number;
  isAdmin: boolean;
}

export interface MyReview {
  rating: number;
  body: string;
  subject: string | null;
  displayName: string;
  consentPublic: boolean;
  status: ReviewStatus;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyReviewState {
  eligibility: ReviewEligibility;
  review: MyReview | null;
  defaultName: string;
  subjects: string[];
}

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  subject: string | null;
  displayName: string;
  adminReply: string | null;
  publishedAt: string | null;
}

export interface PublicReviews {
  count: number;
  average: number | null;
  reviews: PublicReview[];
}

export interface ReviewInput {
  rating: number;
  body: string;
  subject: string | null;
  displayName: string;
  consentPublic: boolean;
}

async function errorOf(resp: Response, fallback: string): Promise<string> {
  try {
    const j = await resp.json();
    return typeof j?.error === "string" ? j.error : fallback;
  } catch {
    return fallback;
  }
}

export async function loadMyReviewState(): Promise<MyReviewState | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await apiFetch("/reviews/me");
    return resp.ok ? ((await resp.json()) as MyReviewState) : null;
  } catch {
    return null;
  }
}

export async function saveMyReview(input: ReviewInput): Promise<{ review?: MyReview; error?: string }> {
  try {
    const resp = await apiFetch("/reviews/me", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!resp.ok) return { error: await errorOf(resp, "Не удалось сохранить отзыв.") };
    return { review: (await resp.json()).review as MyReview };
  } catch {
    return { error: "Нет связи с сервером. Попробуй ещё раз." };
  }
}

export async function deleteMyReview(): Promise<{ error?: string }> {
  try {
    const resp = await apiFetch("/reviews/me", { method: "DELETE" });
    return resp.ok ? {} : { error: await errorOf(resp, "Не удалось удалить отзыв.") };
  } catch {
    return { error: "Нет связи с сервером. Попробуй ещё раз." };
  }
}

export async function loadPublicReviews(limit = 12): Promise<PublicReviews | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const resp = await apiFetch(`/reviews/public?limit=${limit}`);
    return resp.ok ? ((await resp.json()) as PublicReviews) : null;
  } catch {
    return null;
  }
}

/** Опубликованные отзывы или null, пока не загрузились / их меньше MIN_PUBLIC_REVIEWS (блок тогда не рисуем). */
export function usePublicReviews(limit = 12): PublicReviews | null {
  const [data, setData] = useState<PublicReviews | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPublicReviews(limit).then((d) => {
      if (!cancelled && d && d.reviews.length >= MIN_PUBLIC_REVIEWS) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [limit]);
  return data;
}

/** Состояние отзыва текущего пользователя (null — гость, админ или ещё грузится) + перезагрузка. */
export function useMyReviewState(): { state: MyReviewState | null; loading: boolean; reload: () => Promise<void> } {
  const { profile, isGuestMode } = useAuth();
  const userId = profile?.id;
  const skip = !userId || isGuestMode || !!profile?.isAdmin;
  const [state, setState] = useState<MyReviewState | null>(null);
  const [loading, setLoading] = useState(!skip);

  const reload = useCallback(async () => {
    if (skip) return;
    setState(await loadMyReviewState());
    setLoading(false);
  }, [skip]);

  useEffect(() => {
    if (skip) {
      setState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    loadMyReviewState().then((s) => {
      if (!cancelled) {
        setState(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [skip, userId]);

  return { state, loading, reload };
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  private: "Виден только команде",
  pending: "На модерации",
  approved: "Опубликован",
  rejected: "Не опубликован",
};

// ───────────── админка ─────────────

export interface AdminReview extends MyReview {
  id: string;
  userId: string;
  email: string;
}

export interface AdminReviews {
  counts: Record<ReviewStatus, number>;
  reviews: AdminReview[];
}

export async function loadAdminReviews(status?: ReviewStatus): Promise<AdminReviews | null> {
  try {
    const resp = await apiFetch(`/admin/reviews${status ? `?status=${status}` : ""}`);
    return resp.ok ? ((await resp.json()) as AdminReviews) : null;
  } catch {
    return null;
  }
}

export async function moderateAdminReview(id: string, action: "approve" | "reject" | "unpublish" | "reply", reply?: string): Promise<{ review?: AdminReview; error?: string }> {
  try {
    const resp = await apiFetch(`/admin/reviews/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reply }) });
    if (!resp.ok) return { error: await errorOf(resp, "Не удалось выполнить действие.") };
    return { review: (await resp.json()).review as AdminReview };
  } catch {
    return { error: "Нет связи с сервером. Попробуй ещё раз." };
  }
}
