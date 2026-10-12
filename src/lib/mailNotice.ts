// Объявление «письма временно не приходят» (docker/api/siteNotice.js). Админ включает его в /admin → Почта,
// посетители видят на экранах регистрации, входа и «Подтверди почту». Хранится в public.app_settings,
// ключ 'mail_notice' (читать/писать напрямую может только админ), публично читается через GET /site-notice/mail.
import { apiFetch, isSupabaseConfigured, supabase } from "./supabase";

export interface MailNoticeSettings {
  enabled: boolean;
  /** пусто — на сайте покажется текст по умолчанию (DEFAULT_MAIL_NOTICE_TEXT) */
  text: string;
}

export const MAIL_NOTICE_MAX = 600;

/** Тот же текст, что и на сервере (docker/api/siteNotice.js): подсказка в админке и значение, если поле пустое. */
export const DEFAULT_MAIL_NOTICE_TEXT =
  "Из-за сбоя на стороне Яндекса, через который мы отправляем почту, письма с подтверждением и ссылки для сброса пароля сейчас не доходят. " +
  "Дело не в твоём адресе и не в твоих действиях. Яндекс уже устраняет неполадку, и скоро всё заработает. " +
  "Регистрируйся как обычно: аккаунт сохранится, а письмо с кнопкой подтверждения мы отправим, как только почта восстановится.";

export const DEFAULT_MAIL_NOTICE: MailNoticeSettings = { enabled: false, text: "" };

export interface PublicMailNotice {
  active: boolean;
  text: string;
}

/** Публичное объявление. Любой сбой — «объявления нет»: форма входа не должна зависеть от этого запроса. */
export async function loadPublicMailNotice(): Promise<PublicMailNotice> {
  try {
    const res = await apiFetch("/site-notice/mail");
    if (!res.ok) return { active: false, text: "" };
    const data = (await res.json()) as Partial<PublicMailNotice>;
    return data.active === true && typeof data.text === "string" && data.text ? { active: true, text: data.text } : { active: false, text: "" };
  } catch {
    return { active: false, text: "" };
  }
}

export async function loadMailNoticeSettings(): Promise<MailNoticeSettings> {
  if (!isSupabaseConfigured || !supabase) return DEFAULT_MAIL_NOTICE;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "mail_notice").maybeSingle();
  if (error || !data) return DEFAULT_MAIL_NOTICE;
  const v = data.value as Partial<MailNoticeSettings>;
  return { enabled: v.enabled === true, text: typeof v.text === "string" ? v.text : "" };
}

export async function saveMailNoticeSettings(settings: MailNoticeSettings, userId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const value: MailNoticeSettings = { enabled: settings.enabled, text: settings.text.replace(/\s+/g, " ").trim().slice(0, MAIL_NOTICE_MAX) };
  const { error } = await supabase.from("app_settings").upsert({ key: "mail_notice", value, updated_by: userId });
  return error ? { error: error.message } : {};
}
