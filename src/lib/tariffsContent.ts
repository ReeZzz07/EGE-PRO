// Текст вокруг карточек тарифов на публичной странице (эйбрау, заголовок, подзаголовок, заметка
// про поштучную цену, дисклеймер про оплату) — редактируется в /admin → «Тарифы». Сами карточки
// тарифов (цена/предметы/список преимуществ) — отдельно, см. lib/tariffs.ts. Ссылка на оферту/
// политику под тарифами не входит сюда намеренно: это функциональные ссылки, а не просто текст.
import { supabase, isSupabaseConfigured } from "./supabase";
import tariffsDefaults from "../../docker/api/content/tariffsPage.json";

export interface TariffsFaqItem {
  q: string;
  a: string;
}

export interface TariffsPageContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** показывается только если среди активных тарифов есть хоть один платный */
  perSubjectNote: string;
  paymentNote: string;
  /** AEO: видимый FAQ = FAQPage JSON-LD (тот же массив) */
  faq?: TariffsFaqItem[];
}

/** Источник текста — docker/api/content/tariffsPage.json: тот же файл читает сервер для страницы ботам (docker/api/botPages.js). */
export const DEFAULT_TARIFFS_CONTENT: TariffsPageContent = tariffsDefaults;

export async function loadTariffsContent(): Promise<TariffsPageContent> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_TARIFFS_CONTENT;
  const { data, error } = await supabase.from("content_blocks").select("data").eq("key", "tariffsPage").maybeSingle();
  if (error || !data?.data) return DEFAULT_TARIFFS_CONTENT;
  const saved = data.data as Partial<TariffsPageContent>;
  // faq из БД пустой/отсутствует — оставляем дефолт из JSON (AEO-пакет), не затираем
  const faq = Array.isArray(saved.faq) && saved.faq.length > 0 ? saved.faq : DEFAULT_TARIFFS_CONTENT.faq;
  return { ...DEFAULT_TARIFFS_CONTENT, ...saved, faq };
}

export async function saveTariffsContent(data: TariffsPageContent, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key: "tariffsPage", data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
