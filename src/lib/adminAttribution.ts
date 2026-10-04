// Отчёт «источник → воронка → оплаты» для админки (docker/api/attribution.js → GET /admin/attribution).
import { apiFetch } from "./supabase";

export interface AttributionRow {
  channel: string;
  campaign: string;
  regs: number;
  confirmed: number;
  onboarded: number;
  diagnostic: number;
  active: number;
  paid: number;
  revenue: number;
}

export interface AttributionReport {
  rows: AttributionRow[];
  domains: { domain: string; regs: number; confirmed: number }[];
  total: Omit<AttributionRow, "channel" | "campaign">;
}

export async function loadAttributionReport(from?: string, to?: string): Promise<AttributionReport | null> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const query = qs.toString();
  try {
    const resp = await apiFetch(`/admin/attribution${query ? `?${query}` : ""}`);
    return resp.ok ? ((await resp.json()) as AttributionReport) : null;
  } catch {
    return null;
  }
}

/** Рекомендуемый шаблон параметров для ссылок объявлений в Яндекс Директе (макросы Директа подставят значения сами). */
export const DIRECT_UTM_TEMPLATE = "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}";
