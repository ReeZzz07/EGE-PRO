// Статистика «попросить родителя оплатить» для админки (docker/api/parentPay.js → GET /admin/parent-pay).
import { apiFetch } from "./supabase";

export interface ParentPayStats {
  created: number;
  shared: number;
  shared_copy: number;
  shared_whatsapp: number;
  shared_telegram: number;
  emails_sent: number;
  emails_failed: number;
  opened: number;
  pay_started: number;
  paid: number;
  revenue: number;
}

export async function loadParentPayStats(from?: string, to?: string): Promise<ParentPayStats | null> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const query = qs.toString();
  try {
    const resp = await apiFetch(`/admin/parent-pay${query ? `?${query}` : ""}`);
    return resp.ok ? ((await resp.json()) as ParentPayStats) : null;
  } catch {
    return null;
  }
}
