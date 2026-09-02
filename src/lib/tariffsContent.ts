// Текст вокруг карточек тарифов на публичной странице (эйбрау, заголовок, подзаголовок, заметка
// про поштучную цену, дисклеймер про оплату) — редактируется в /admin → «Тарифы». Сами карточки
// тарифов (цена/предметы/список преимуществ) — отдельно, см. lib/tariffs.ts. Ссылка на оферту/
// политику под тарифами не входит сюда намеренно: это функциональные ссылки, а не просто текст.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface TariffsPageContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** показывается только если среди активных тарифов есть хоть один платный */
  perSubjectNote: string;
  paymentNote: string;
}

export const DEFAULT_TARIFFS_CONTENT: TariffsPageContent = {
  eyebrow: "тарифы",
  title: "Выбери, сколько предметов готовить",
  subtitle:
    "Диагностика, план, задания из банка ФИПИ и ИИ-репетитор — на всех тарифах. Разница только в числе предметов и лимите обращений к репетитору.",
  perSubjectNote: "при поштучной покупке — от 1290 ₽/мес за предмет",
  paymentNote: "Оплата подключается позже — сейчас выбор тарифа применяется к аккаунту сразу, без списания денег.",
};

export async function loadTariffsContent(): Promise<TariffsPageContent> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_TARIFFS_CONTENT;
  const { data, error } = await supabase.from("content_blocks").select("data").eq("key", "tariffsPage").maybeSingle();
  if (error || !data?.data) return DEFAULT_TARIFFS_CONTENT;
  return { ...DEFAULT_TARIFFS_CONTENT, ...(data.data as Partial<TariffsPageContent>) };
}

export async function saveTariffsContent(data: TariffsPageContent, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key: "tariffsPage", data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
