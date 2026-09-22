// Текст приветственного письма с советами (уходит один раз, после подтверждения email — см.
// docker/api/mailer.js → sendWelcomeEmail, вызывается из POST /auth/verify-email в server.js).
// public.app_settings, ключ 'welcome_email', тот же паттерн, что у lib/mailSettings.ts /
// lib/aiSettings.ts. Оформление письма НЕ отсюда — это код в mailer.js (wrapBrandedHtml), здесь
// только то, что реально пишут человеку.
import { apiFetch, supabase, isSupabaseConfigured } from "./supabase";

export interface WelcomeEmailSettings {
  subject: string;
  bodyText: string;
}

// Держим текстуально синхронно с DEFAULT_WELCOME_EMAIL_SUBJECT/BODY в docker/api/mailer.js — это
// то, чем засеяна БД при первом старте, и то, что видит админ, пока ни разу не сохранял свою
// версию (см. loadWelcomeEmailSettings ниже).
export const DEFAULT_WELCOME_EMAIL_SUBJECT = "Как получить максимум от ЕГЭ·ПРО";
export const DEFAULT_WELCOME_EMAIL_BODY = `Поздравляем с подтверждением почты — теперь платформа открыта полностью. Вот пять вещей, которые реально влияют на результат на экзамене.

Начни с диагностики по каждому предмету. Это 8–12 заданий на 7–10 минут — по ним строится личный план: что повторить сегодня, а что подождёт до следующей недели.

Занимайся понемногу, но каждый день, а не раз в неделю по три часа. Регулярность даёт лучший результат, чем редкие марафоны — даже 20–30 минут в день ощутимо двигают дело.

Проси у ИИ-репетитора подсказки по уровням, начиная с первого. Он не решает задание за тебя, а объясняет метод — так двигаешься сам и запоминаешь принцип, а не готовый ответ.

Возвращайся в тетрадь ошибок. Задания, где ты один раз ошибся, — самое полезное место для повторной тренировки: система сама собирает их туда.

Ближе к экзамену решай варианты в режиме «Пробник» — с таймером и в формате настоящего ЕГЭ. Это тренирует не только знания, но и скорость, и нервы.

Успехов на подготовке!`;

export const DEFAULT_WELCOME_EMAIL_SETTINGS: WelcomeEmailSettings = {
  subject: DEFAULT_WELCOME_EMAIL_SUBJECT,
  bodyText: DEFAULT_WELCOME_EMAIL_BODY,
};

export async function loadWelcomeEmailSettings(): Promise<WelcomeEmailSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_WELCOME_EMAIL_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "welcome_email").maybeSingle();
  if (error || !data) return DEFAULT_WELCOME_EMAIL_SETTINGS;
  const v = data.value as Partial<WelcomeEmailSettings>;
  return {
    subject: v.subject?.trim() ? v.subject : DEFAULT_WELCOME_EMAIL_SUBJECT,
    bodyText: v.bodyText?.trim() ? v.bodyText : DEFAULT_WELCOME_EMAIL_BODY,
  };
}

export async function saveWelcomeEmailSettings(settings: WelcomeEmailSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "welcome_email", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}

/** Шлёт письмо с ТЕКУЩИМ (необязательно сохранённым) текстом формы на почту самого админа — идёт
 * через docker/api (нужен реальный SMTP-транспорт из mailer.js), не через PostgREST, в отличие от
 * load/save выше (см. POST /admin/welcome-email/test в server.js). */
export async function sendTestWelcomeEmail(settings: WelcomeEmailSettings): Promise<{ error?: string }> {
  const resp = await apiFetch("/admin/welcome-email/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (resp.ok) return {};
  const json = await resp.json().catch(() => ({}) as { error?: string });
  return { error: json.error ?? resp.statusText };
}
