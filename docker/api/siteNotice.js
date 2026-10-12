// Объявление «письма временно не приходят»: админ включает его в /admin → Почта (public.app_settings, ключ
// 'mail_notice'), а экраны регистрации, входа и «Подтверди почту» показывают его всем посетителям. Читать
// app_settings может только админ (RLS), поэтому публичное чтение — отсюда, GET /site-notice/mail.
import { pool } from "./db.js";

export const MAIL_NOTICE_KEY = "mail_notice";
/** Верхняя граница длины текста: объявление — это пара предложений, а не страница. */
export const MAIL_NOTICE_MAX = 600;

/** Что показываем, если админ включил объявление, но текст оставил пустым. */
export const DEFAULT_MAIL_NOTICE_TEXT =
  "Из-за сбоя на стороне Яндекса, через который мы отправляем почту, письма с подтверждением и ссылки для сброса пароля сейчас не доходят. " +
  "Дело не в твоём адресе и не в твоих действиях. Яндекс уже устраняет неполадку, и скоро всё заработает. " +
  "Регистрируйся как обычно: аккаунт сохранится, а письмо с кнопкой подтверждения мы отправим, как только почта восстановится.";

/** Значение из БД (что угодно) → безопасный вид { enabled, text }. Текст — всегда простой, без разметки. */
export function normalizeMailNotice(value) {
  const v = value && typeof value === "object" ? value : {};
  const enabled = v.enabled === true;
  const raw = typeof v.text === "string" ? v.text.replace(/\s+/g, " ").trim() : "";
  const text = (raw || DEFAULT_MAIL_NOTICE_TEXT).slice(0, MAIL_NOTICE_MAX);
  return { enabled, text };
}

const CACHE_MS = 15 * 1000;
let cache = { at: 0, value: null };

/** Публичный вид объявления. Короткий кеш: страница регистрации открывается часто, а правится объявление раз в день. */
export async function getPublicMailNotice({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache.value && now - cache.at < CACHE_MS) return cache.value;
  const { rows } = await pool.query("select value from public.app_settings where key = $1", [MAIL_NOTICE_KEY]);
  const n = normalizeMailNotice(rows[0]?.value);
  const value = n.enabled ? { active: true, text: n.text } : { active: false, text: "" };
  cache = { at: now, value };
  return value;
}
