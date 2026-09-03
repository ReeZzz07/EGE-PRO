// Тарифы подписки — public.tariffs (supabase/migrations/0009_tariffs.sql). Публичное чтение
// активных тарифов доступно всем (в т.ч. гостям), запись — только администраторам.
// Оплаты нет: selectTariff() — просто запись tariff_id в профиль (см. комментарий в миграции).
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";

export interface Tariff {
  id: string;
  name: string;
  badge: string | null;
  priceRub: number;
  /** Цена со скидкой (меньше priceRub) — если задана, на публичной странице показываем
   *  старую цену зачёркнутой рядом с этой. null — скидки нет. */
  salePriceRub: number | null;
  subjectsCount: number;
  dailyAiLimit: number | null;
  /** Список преимуществ тарифа (пункты со значком-галочкой на публичной странице), задаётся
   *  админом произвольно — см. AdminTariffs.tsx. */
  features: string[];
  sortOrder: number;
  isActive: boolean;
}

/** Фолбэк на случай отключённого бэкенда (гостевой режим) — совпадает с сидами миграции,
 *  чтобы страница тарифов не была пустой без Docker-стека. */
const FALLBACK_TARIFFS: Tariff[] = [
  { id: "free", name: "Попробовать", badge: "Бесплатно", priceRub: 0, salePriceRub: null, subjectsCount: 2, dailyAiLimit: 3, features: ["2 предмета на выбор", "до 3 обращений к ИИ-репетитору в день", "Диагностика, план, пробные варианты"], sortOrder: 0, isActive: true },
  { id: "attestat", name: "АТТЕСТАТ", badge: null, priceRub: 1990, salePriceRub: null, subjectsCount: 2, dailyAiLimit: null, features: ["2 предмета на выбор", "Безлимитный ИИ-репетитор", "Диагностика, план, пробные варианты"], sortOrder: 1, isActive: true },
  { id: "vuz", name: "ВУЗ", badge: "🔥 Популярный выбор", priceRub: 3990, salePriceRub: null, subjectsCount: 4, dailyAiLimit: null, features: ["4 предмета на выбор", "Безлимитный ИИ-репетитор", "Диагностика, план, пробные варианты"], sortOrder: 2, isActive: true },
  { id: "vuz-plus", name: "ВУЗ+", badge: null, priceRub: 4990, salePriceRub: null, subjectsCount: 5, dailyAiLimit: null, features: ["5 предметов на выбор", "Безлимитный ИИ-репетитор", "Диагностика, план, пробные варианты"], sortOrder: 3, isActive: true },
];

function fromRow(row: Record<string, unknown>): Tariff {
  return {
    id: row.id as string,
    name: row.name as string,
    badge: (row.badge as string | null) ?? null,
    priceRub: row.price_rub as number,
    salePriceRub: (row.sale_price_rub as number | null) ?? null,
    subjectsCount: row.subjects_count as number,
    dailyAiLimit: (row.daily_ai_limit as number | null) ?? null,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
  };
}

/** Активные тарифы — для публичной страницы тарифов (лендинг/кабинет), видно и гостям. */
export async function loadActiveTariffs(): Promise<Tariff[]> {
  if (!isSupabaseConfigured || !supabase) return FALLBACK_TARIFFS;
  const { data, error } = await supabase.from("tariffs").select("*").eq("is_active", true).order("sort_order");
  if (error || !data) return FALLBACK_TARIFFS;
  return (data as Record<string, unknown>[]).map(fromRow);
}

/** Все тарифы, включая скрытые — для админки. */
export async function loadAllTariffs(): Promise<Tariff[]> {
  if (!isSupabaseConfigured || !supabase) return FALLBACK_TARIFFS;
  const { data, error } = await supabase.from("tariffs").select("*").order("sort_order");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow);
}

export type TariffInput = Omit<Tariff, "sortOrder"> & { sortOrder?: number };

function friendlyWriteError(message: string): string {
  if (/tariffs_sale_price_valid/.test(message)) return "Цена со скидкой должна быть меньше обычной цены (и не отрицательной).";
  return message;
}

export async function createTariff(t: TariffInput): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("tariffs").insert({
    id: t.id,
    name: t.name,
    badge: t.badge || null,
    price_rub: t.priceRub,
    sale_price_rub: t.salePriceRub,
    subjects_count: t.subjectsCount,
    daily_ai_limit: t.dailyAiLimit,
    features: t.features,
    sort_order: t.sortOrder ?? 0,
    is_active: t.isActive,
  });
  return error ? { error: friendlyWriteError(error.message) } : {};
}

export async function updateTariff(id: string, patch: Partial<TariffInput>): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.badge !== undefined) row.badge = patch.badge || null;
  if (patch.priceRub !== undefined) row.price_rub = patch.priceRub;
  if (patch.salePriceRub !== undefined) row.sale_price_rub = patch.salePriceRub;
  if (patch.subjectsCount !== undefined) row.subjects_count = patch.subjectsCount;
  if (patch.dailyAiLimit !== undefined) row.daily_ai_limit = patch.dailyAiLimit;
  if (patch.features !== undefined) row.features = patch.features;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  const { error } = await supabase.from("tariffs").update(row).eq("id", id);
  return error ? { error: friendlyWriteError(error.message) } : {};
}

export async function deleteTariff(id: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("tariffs").delete().eq("id", id);
  if (error) {
    // FK на profiles.tariff_id — на этом тарифе ещё есть пользователи
    if (/foreign key|violates/i.test(error.message)) return { error: "Нельзя удалить: на этом тарифе ещё есть пользователи. Сначала переведи их на другой тариф." };
    return { error: error.message };
  }
  return {};
}

/** Доступна ли пользователю проверка сочинений/развёрнутых ответов ИИ-репетитором — только платные
 *  тарифы (price_rub > 0) и админы, которые тариф игнорируют вообще. null, пока не загрузилось.
 *  Это только UI-гейт (не пускать писать сочинение, которое всё равно не проверят) — настоящая
 *  защита на сервере, см. docker/api/server.js (resolveUserTariffGate, ответ с tierBlocked). */
export function useEssayCheckAllowed(profile: { isAdmin?: boolean; tariffId?: string } | null): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const isAdmin = profile?.isAdmin ?? false;
  const tariffId = profile?.tariffId;

  useEffect(() => {
    if (!profile) {
      setAllowed(false);
      return;
    }
    if (isAdmin) {
      setAllowed(true);
      return;
    }
    let cancelled = false;
    loadActiveTariffs().then((tariffs) => {
      if (cancelled) return;
      const t = tariffs.find((x) => x.id === tariffId);
      setAllowed(!!t && t.priceRub > 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, isAdmin, tariffId]);

  return allowed;
}
