import { supabase, isSupabaseConfigured } from "./supabase";
import landingDefaults from "../../docker/api/content/landing.json";

export interface HeroContent {
  title: string;
  /** подстрока в title, которую нужно выделить hl-подсветкой */
  highlight: string;
  subtitle: string;
}

export interface CapabilityItem {
  icon: string;
  t: string;
  d: string;
}

export interface ProcessItem {
  n: string;
  icon: string;
  t: string;
  d: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface LandingContent {
  hero: HeroContent;
  capabilities: CapabilityItem[];
  process: ProcessItem[];
  faq: FaqItem[];
  /** строки в бегущей строке под первым экраном — фразы и формулы */
  ticker: string[];
}

export const CONTENT_KEYS = ["hero", "capabilities", "process", "faq", "ticker"] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

/** Список доступных иконок для выбора в админке (см. src/components/ui.tsx PATHS) */
export const ICON_OPTIONS = [
  "target", "timer", "chat", "book", "check", "x", "arrowR", "arrowL", "star", "flame",
  "chart", "search", "bulb", "refresh", "trash", "send", "spark", "sigma", "home", "list", "alert", "eye",
] as const;

/** Источник текста — docker/api/content/landing.json: тот же файл читает сервер, когда отдаёт страницу ботам (docker/api/botPages.js). */
export const DEFAULT_CONTENT = landingDefaults as unknown as LandingContent;

/** Загружает контент лендинга из Supabase; при отсутствии подключения/данных — честный локальный дефолт. */
export async function loadLandingContent(): Promise<LandingContent> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_CONTENT;
  const { data, error } = await supabase.from("content_blocks").select("key, data");
  if (error || !data || data.length === 0) return DEFAULT_CONTENT;
  const map = new Map(data.map((row) => [row.key, row.data]));
  return {
    hero: (map.get("hero") as HeroContent) ?? DEFAULT_CONTENT.hero,
    capabilities: (map.get("capabilities") as CapabilityItem[]) ?? DEFAULT_CONTENT.capabilities,
    process: (map.get("process") as ProcessItem[]) ?? DEFAULT_CONTENT.process,
    faq: (map.get("faq") as FaqItem[]) ?? DEFAULT_CONTENT.faq,
    ticker: (map.get("ticker") as string[]) ?? DEFAULT_CONTENT.ticker,
  };
}

export async function saveLandingBlock(key: ContentKey, data: unknown, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key, data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
