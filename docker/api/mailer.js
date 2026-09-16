// Отправка писем через SMTP (nodemailer) — сброс пароля, подтверждение email, чек об оплате.
// Настройки (host/port/логин/пароль) — тот же паттерн, что у resolveAiSettings/
// resolveYookassaSettings: public.app_settings, ключ 'smtp', редактируется в /admin → Почта,
// .env — запасной вариант, если админ ещё не сохранил в БД.
import nodemailer from "nodemailer";
import { pool } from "./db.js";

/** См. resolveAiSettings/resolveYookassaSettings — та же логика приоритета БД над .env. */
export async function resolveSmtpSettings() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'smtp'");
    const v = rows[0]?.value;
    if (v?.host && v?.user && v?.password) {
      return {
        host: v.host,
        port: Number(v.port) || 465,
        secure: v.secure !== false,
        user: v.user,
        password: v.password,
        fromName: v.fromName || "ЕГЭ·ПРО",
        fromAddress: v.fromAddress || v.user,
      };
    }
  } catch (e) {
    console.warn("не удалось прочитать настройки SMTP из app_settings, использую .env:", e?.message ?? e);
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE !== "false",
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      fromName: process.env.SMTP_FROM_NAME || "ЕГЭ·ПРО",
      fromAddress: process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER,
    };
  }
  return null;
}

// Транспорт кешируется по строке подключения — пересоздавать соединение на каждое письмо не
// нужно, а держать ровно один транспорт на весь процесс безопасно, потому что настройки меняются
// крайне редко (правка в админке) и до следующего письма новый resolveSmtpSettings всё равно
// вызывается заново, так что смена ключа в БД подхватится сама, без рестарта контейнера.
let cachedTransport = null;
let cachedKey = "";

function transportFor(settings) {
  const key = `${settings.host}:${settings.port}:${settings.user}`;
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
  });
  cachedKey = key;
  return cachedTransport;
}

/** Отправка — best-effort везде, где письмо не является сутью запроса (регистрация, оплата не
 * должны падать из-за временной проблемы с почтой): вызывающий код сам решает, ловить ли ошибку
 * или дать ей всплыть, эта функция не глотает исключения молча. */
export async function sendMail({ to, subject, text, html }) {
  const settings = await resolveSmtpSettings();
  if (!settings) throw new Error("SMTP не настроен — задай его в /admin → Почта");
  const transport = transportFor(settings);
  await transport.sendMail({
    from: `"${settings.fromName}" <${settings.fromAddress}>`,
    to,
    subject,
    text,
    html,
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapHtml(bodyHtml) {
  return `<!doctype html><html lang="ru"><body style="font-family:sans-serif;color:#15172e;max-width:480px;margin:0 auto;padding:24px 16px;">
${bodyHtml}
<p style="margin-top:32px;font-size:12px;color:#8a8d9a;">ЕГЭ·ПРО — тренажёр подготовки к ЕГЭ с ИИ-репетитором</p>
</body></html>`;
}

export async function sendVerifyEmail(to, verifyUrl) {
  await sendMail({
    to,
    subject: "Подтверди email — ЕГЭ·ПРО",
    text: `Подтверди свой email, перейдя по ссылке: ${verifyUrl}\n\nЕсли ты не регистрировался(-лась) на ЕГЭ·ПРО — просто проигнорируй это письмо.`,
    html: wrapHtml(`
<h2 style="font-size:18px;">Подтверди email</h2>
<p>Нажми на кнопку ниже, чтобы подтвердить свой адрес и полноценно пользоваться ЕГЭ·ПРО.</p>
<p style="margin:24px 0;"><a href="${escapeHtml(verifyUrl)}" style="background:#2451ff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:bold;">Подтвердить email</a></p>
<p style="font-size:12px;color:#8a8d9a;">Если кнопка не работает, скопируй ссылку: ${escapeHtml(verifyUrl)}</p>
<p style="font-size:12px;color:#8a8d9a;">Если ты не регистрировался(-лась) на ЕГЭ·ПРО — просто проигнорируй это письмо.</p>
`),
  });
}

export async function sendPasswordResetEmail(to, resetUrl) {
  await sendMail({
    to,
    subject: "Сброс пароля — ЕГЭ·ПРО",
    text: `Чтобы сбросить пароль, перейди по ссылке (действует 1 час): ${resetUrl}\n\nЕсли ты не запрашивал(а) сброс пароля — просто проигнорируй это письмо, пароль останется прежним.`,
    html: wrapHtml(`
<h2 style="font-size:18px;">Сброс пароля</h2>
<p>Нажми на кнопку ниже, чтобы задать новый пароль. Ссылка действует 1 час.</p>
<p style="margin:24px 0;"><a href="${escapeHtml(resetUrl)}" style="background:#2451ff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:bold;">Сбросить пароль</a></p>
<p style="font-size:12px;color:#8a8d9a;">Если кнопка не работает, скопируй ссылку: ${escapeHtml(resetUrl)}</p>
<p style="font-size:12px;color:#8a8d9a;">Если ты не запрашивал(а) сброс пароля — просто проигнорируй это письмо, пароль останется прежним.</p>
`),
  });
}

export async function sendPaymentReceiptEmail(to, { tariffName, amountRub, periodDays, expiresAt }) {
  const expiresText = new Date(expiresAt).toLocaleDateString("ru-RU");
  await sendMail({
    to,
    subject: `Оплата прошла — тариф «${tariffName}»`,
    text: `Спасибо за оплату!\n\nТариф: ${tariffName}\nСумма: ${amountRub} ₽\nДействует: ${periodDays} дней, до ${expiresText}\n\nЕГЭ·ПРО`,
    html: wrapHtml(`
<h2 style="font-size:18px;">Оплата прошла успешно</h2>
<p>Тариф активирован.</p>
<table style="margin:16px 0;font-size:14px;">
<tr><td style="padding:4px 12px 4px 0;color:#8a8d9a;">Тариф</td><td><strong>${escapeHtml(tariffName)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#8a8d9a;">Сумма</td><td>${escapeHtml(String(amountRub))} ₽</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#8a8d9a;">Действует до</td><td>${escapeHtml(expiresText)}</td></tr>
</table>
`),
  });
}
