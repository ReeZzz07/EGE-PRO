// Значки «что требует внимания» в админке (docker/api/adminNotify.js → GET /admin/badges): новые обращения,
// отзывы на модерации. Один общий опрос раз в минуту на всех подписчиков (шапка и вкладки админки);
// после действий админа (ответ, смена статуса, модерация) вызывается refreshAdminBadges(), чтобы цифра
// обновилась сразу, а не через минуту.
import { useEffect, useState } from "react";
import { apiFetch, isSupabaseConfigured } from "./supabase";
import { useAuth } from "./auth";

export interface AdminBadges {
  feedbackNew: number;
  feedbackOverdue: number;
  feedbackDeliveryFailed: number;
  reviewsPending: number;
  /** сумма для значка на пункте «Админка» */
  total: number;
}

const POLL_MS = 60_000;
let current: AdminBadges | null = null;
const listeners = new Set<(b: AdminBadges | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function fetchBadges() {
  if (!isSupabaseConfigured) return;
  try {
    const resp = await apiFetch("/admin/badges");
    if (!resp.ok) return;
    current = (await resp.json()) as AdminBadges;
    listeners.forEach((l) => l(current));
  } catch {
    /* сеть моргнула — оставляем прежние цифры */
  }
}

export function refreshAdminBadges(): void {
  void fetchBadges();
}

/** Числа для значков; null для не-админов (запросов тогда нет вовсе). */
export function useAdminBadges(): AdminBadges | null {
  const { profile } = useAuth();
  const enabled = !!profile?.isAdmin;
  const [badges, setBadges] = useState<AdminBadges | null>(enabled ? current : null);

  useEffect(() => {
    if (!enabled) {
      setBadges(null);
      return;
    }
    listeners.add(setBadges);
    setBadges(current);
    void fetchBadges();
    if (!timer) timer = setInterval(() => void fetchBadges(), POLL_MS);
    return () => {
      listeners.delete(setBadges);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [enabled]);

  return enabled ? badges : null;
}
