import { supabase, isSupabaseConfigured } from "./supabase";

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
}

export const CONTENT_KEYS = ["hero", "capabilities", "process", "faq"] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

/** Список доступных иконок для выбора в админке (см. src/components/ui.tsx PATHS) */
export const ICON_OPTIONS = [
  "target", "timer", "chat", "book", "check", "x", "arrowR", "arrowL", "star", "flame",
  "chart", "search", "bulb", "refresh", "trash", "send", "spark", "sigma", "home", "list", "alert", "eye",
] as const;

export const DEFAULT_CONTENT: LandingContent = {
  hero: {
    title: "Подготовка к ЕГЭ с ИИ-репетитором, который объясняет, а не решает за тебя",
    highlight: "ИИ-репетитором",
    subtitle:
      "Диагностика уровня, персональный план, задания из открытого банка ФИПИ, уровневые подсказки и проверка сочинений по критериям. Без списывания — с пониманием.",
  },
  capabilities: [
    { icon: "target", t: "Диагностика уровня", d: "8–12 заданий — и понятно, с чего начинать." },
    { icon: "book", t: "Персональный план", d: "Что повторить сегодня, сколько тренироваться на неделе." },
    { icon: "list", t: "Задания формата ЕГЭ", d: "Открытый банк ФИПИ, мгновенная проверка по эталону." },
    { icon: "chat", t: "ИИ-объяснения без готовых ответов", d: "Наводит на решение вопросами, а не выдаёт результат." },
    { icon: "check", t: "Проверка сочинений и развёрнутых ответов", d: "По критериям, с чёткими баллами по каждому пункту." },
    { icon: "timer", t: "Пробные варианты", d: "Таймер, часть 1 и часть 2 — как на настоящем экзамене." },
  ],
  process: [
    { n: "01", icon: "target", t: "Диагностика", d: "8–12 заданий по предмету, 7–10 минут. Без подсказок — так точнее видно, что уже знаешь, а что нет." },
    { n: "02", icon: "book", t: "Персональный план", d: "На основе результатов — что повторить сегодня, сколько тренировок на неделе и когда пробник." },
    { n: "03", icon: "chat", t: "Тренировки с ИИ", d: "Решаешь задания, при затруднении — уровневые подсказки и объяснение темы, без готового ответа." },
    { n: "04", icon: "timer", t: "Пробный вариант", d: "Часть 1 и часть 2 на время, без подсказок — как на настоящем экзамене. Разбор после сдачи." },
  ],
  faq: [
    {
      q: "Это официальный ресурс ФИПИ?",
      a: "Нет. Это учебный проект, который ориентируется на формат Открытого банка заданий ФИПИ и демоверсии ЕГЭ, но не является официальным ресурсом ФИПИ или Рособрнадзора.",
    },
    {
      q: "ИИ даст готовый ответ, если попросить?",
      a: "Нет, по конструкции. Даже если явно попросить — ИИ объяснит тему, задаст наводящий вопрос или разберёт похожий пример, но не назовёт финальный ответ твоего задания.",
    },
    {
      q: "Нужно заниматься каждый день?",
      a: "Нет. На онбординге ты сам выбираешь темп — от 10 минут до часа в день, план подстраивается под это время.",
    },
    {
      q: "Прогресс сохранится, если я закрою вкладку?",
      a: "Да, после регистрации план, диагностика и история попыток сохраняются в твоём аккаунте и доступны при следующем входе.",
    },
  ],
};

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
  };
}

export async function saveLandingBlock(key: ContentKey, data: unknown, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён — редактирование недоступно в гостевом режиме." };
  const { error } = await supabase.from("content_blocks").upsert({ key, data, updated_at: new Date().toISOString(), updated_by: userId });
  return error ? { error: error.message } : {};
}
