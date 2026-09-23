// Текст приветственного письма с советами (уходит один раз, после подтверждения email — см.
// docker/api/mailer.js → sendWelcomeEmail, вызывается из POST /auth/verify-email в server.js).
// public.app_settings, ключ 'welcome_email', тот же паттерн, что у lib/mailSettings.ts /
// lib/aiSettings.ts. Оформление письма НЕ отсюда — это код в mailer.js (wrapBrandedHtml), здесь
// только то, что реально пишут человеку.
import { apiFetch, supabase, isSupabaseConfigured } from "./supabase";

export interface WelcomeEmailSettings {
  subject: string;
  bodyText: string;
  /** Отдельный блок — показывается в письме, ТОЛЬКО если ученик ещё не прошёл онбординг на момент
   *  отправки (см. sendWelcomeEmail(..., { onboarded }) в mailer.js). */
  onboardingReminderText: string;
}

// Держим текстуально синхронно с DEFAULT_WELCOME_EMAIL_SUBJECT/BODY/DEFAULT_ONBOARDING_REMINDER_TEXT
// в docker/api/mailer.js — это то, чем засеяна БД при первом старте, и то, что видит админ, пока ни
// разу не сохранял свою версию (см. loadWelcomeEmailSettings ниже).
export const DEFAULT_WELCOME_EMAIL_SUBJECT = "Как получить максимум от ЕГЭ·ПРО";
export const DEFAULT_WELCOME_EMAIL_BODY = `ЕГЭ·ПРО — тренажёр для тех, кто готовится к экзамену самостоятельно и хочет реально разбираться в материале, а не запоминать чужие ответы. В отличие от сборников готовых решений и обычных банков заданий, здесь ИИ-репетитор не решает задачи за тебя — он объясняет метод и доводит до последнего шага, а дальше ты доделываешь сам(а). Задания — из открытого банка ФИПИ, то есть именно того формата, что будет на настоящем экзамене.

Начни с диагностики по каждому предмету — 8–12 заданий, 7–10 минут. По результатам сразу строится личный план: что повторить сегодня, а что подождёт до следующей недели, — вместо того чтобы решать всё подряд без разбора.

Занимайся понемногу, но каждый день, а не раз в неделю по три часа. Регулярность даёт лучший результат, чем редкие марафоны — даже 20–30 минут в день ощутимо двигают дело, и это видно на графике прогресса в личном кабинете.

Проси у ИИ-репетитора подсказки по уровням, начиная с первого, — он не выдаёт готовый ответ, а объясняет принцип, чтобы ты дошёл(шла) до решения сам(а) и запомнил(а) метод, а не число. На бесплатном тарифе на это есть суточный лимит обращений — если готовишься по нескольким предметам одновременно, платный тариф снимает это ограничение.

Возвращайся в тетрадь ошибок — она сама собирает туда задания, где ты хоть раз ошибся(лась). Второй проход по своим же ошибкам через день-два закрепляет тему куда лучше, чем ещё десяток новых заданий подряд.

Ближе к экзамену решай варианты в режиме «Пробник» — с таймером и в формате настоящего ЕГЭ. Это тренирует не только знания, но и скорость с нервами: разница между «знаю» и «успеваю за отведённое время» выясняется именно там.

Хочешь готовиться по всем предметам сразу, без дневного лимита ИИ-репетитора и с проверкой сочинений по критериям ФИПИ? На бесплатном тарифе уже открыты русский язык и математика — этого достаточно, чтобы попробовать платформу. Тарифы «Аттестат», «Вуз» и «Вуз+» открывают до 11 предметов и все возможности целиком, от 1990 ₽/мес — посмотри на странице «Тариф», какой подходит именно тебе.

Итог простой: ЕГЭ·ПРО — тренажёр, где искусственный интеллект не подсказывает готовый ответ, а учит его находить, — с реальными заданиями ФИПИ, персональным планом после диагностики и разбором каждой ошибки по шагам. Так баллы получают за понимание, а не за память о чужом решении — и именно поэтому стоит начать сегодня, а не откладывать до последней недели перед экзаменом.`;

export const DEFAULT_ONBOARDING_REMINDER_TEXT = `Кстати: похоже, ты ещё не заполнил(а) анкету подготовки — класс, год сдачи, цель и время в день. Без неё персональный план и «Пробник» не понимают, по какому предмету и в каком темпе тебя вести, и показывают значения по умолчанию вместо твоих реальных. Это займёт меньше минуты: зайди на платформу — сверху будет напоминание с кнопкой «Заполнить».`;

export const DEFAULT_WELCOME_EMAIL_SETTINGS: WelcomeEmailSettings = {
  subject: DEFAULT_WELCOME_EMAIL_SUBJECT,
  bodyText: DEFAULT_WELCOME_EMAIL_BODY,
  onboardingReminderText: DEFAULT_ONBOARDING_REMINDER_TEXT,
};

export async function loadWelcomeEmailSettings(): Promise<WelcomeEmailSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_WELCOME_EMAIL_SETTINGS;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "welcome_email").maybeSingle();
  if (error || !data) return DEFAULT_WELCOME_EMAIL_SETTINGS;
  const v = data.value as Partial<WelcomeEmailSettings>;
  return {
    subject: v.subject?.trim() ? v.subject : DEFAULT_WELCOME_EMAIL_SUBJECT,
    bodyText: v.bodyText?.trim() ? v.bodyText : DEFAULT_WELCOME_EMAIL_BODY,
    onboardingReminderText: v.onboardingReminderText?.trim() ? v.onboardingReminderText : DEFAULT_ONBOARDING_REMINDER_TEXT,
  };
}

export async function saveWelcomeEmailSettings(settings: WelcomeEmailSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("app_settings").upsert({ key: "welcome_email", value: settings, updated_by: userId });
  return error ? { error: error.message } : {};
}

/** Шлёт письмо с ТЕКУЩИМ (необязательно сохранённым) текстом формы на почту самого админа — идёт
 * через docker/api (нужен реальный SMTP-транспорт из mailer.js), не через PostgREST, в отличие от
 * load/save выше (см. POST /admin/welcome-email/test в server.js). Уходит с блоком-напоминанием
 * об онбординге всегда — сервер сам решает так (onboarded:false), чтобы админ видел полную версию. */
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

/** Тот же текст (тема + оба блока), что реально ушёл/уйдёт на почту — для попапа на главной сразу
 * после подтверждения email (см. Dashboard.tsx → WelcomeContentModal.tsx). Доступно ЛЮБОМУ
 * авторизованному, не только админу (см. GET /welcome-email/content в server.js) — сам текст не
 * секретный. Возвращает дефолт локально, если запрос не удался — лучше показать что-то в попапе,
 * чем ничего, раз пользователь уже сюда попал. */
export async function loadWelcomeEmailContentForViewer(): Promise<WelcomeEmailSettings> {
  try {
    const resp = await apiFetch("/welcome-email/content");
    if (!resp.ok) return DEFAULT_WELCOME_EMAIL_SETTINGS;
    return (await resp.json()) as WelcomeEmailSettings;
  } catch {
    return DEFAULT_WELCOME_EMAIL_SETTINGS;
  }
}
