// Отправка писем через SMTP (nodemailer) — сброс пароля, подтверждение email, чек об оплате,
// приветственное письмо с советами после подтверждения email. Настройки (host/port/логин/пароль) —
// тот же паттерн, что у resolveAiSettings/resolveYookassaSettings: public.app_settings, ключ 'smtp',
// редактируется в /admin → Почта, .env — запасной вариант, если админ ещё не сохранил в БД.
import nodemailer from "nodemailer";
import { pool } from "./db.js";

// Тема/текст приветственного письма — редактируются в /admin → Почта (public.app_settings, ключ
// 'welcome_email', см. resolveWelcomeEmailSettings ниже и src/lib/welcomeEmailSettings.ts). Эти
// константы — то, чем засеяна форма админки при первом открытии (DEFAULT_WELCOME_EMAIL_SETTINGS
// в welcomeEmailSettings.ts держим текстуально синхронным с этими, как DEFAULT_POLICY/
// DEFAULT_SYSTEM_PROMPT в prompt.js/aiPrompt.ts) и запасной вариант, если админ ещё не сохранял
// свою версию. Оформление письма (шапка, кнопка, цвета) — НЕ отсюда, это код в wrapBrandedHtml
// ниже, править не через админку.
export const DEFAULT_WELCOME_EMAIL_SUBJECT = "Как получить максимум от ЕГЭ·ПРО";
export const DEFAULT_WELCOME_EMAIL_BODY = `Поздравляем с подтверждением почты — теперь платформа открыта полностью. Вот пять вещей, которые реально влияют на результат на экзамене.

Начни с диагностики по каждому предмету. Это 8–12 заданий на 7–10 минут — по ним строится личный план: что повторить сегодня, а что подождёт до следующей недели.

Занимайся понемногу, но каждый день, а не раз в неделю по три часа. Регулярность даёт лучший результат, чем редкие марафоны — даже 20–30 минут в день ощутимо двигают дело.

Проси у ИИ-репетитора подсказки по уровням, начиная с первого. Он не решает задание за тебя, а объясняет метод — так двигаешься сам и запоминаешь принцип, а не готовый ответ.

Возвращайся в тетрадь ошибок. Задания, где ты один раз ошибся, — самое полезное место для повторной тренировки: система сама собирает их туда.

Ближе к экзамену решай варианты в режиме «Пробник» — с таймером и в формате настоящего ЕГЭ. Это тренирует не только знания, но и скорость, и нервы.

Успехов на подготовке!`;

export const DEFAULT_WELCOME_EMAIL_SETTINGS = { subject: DEFAULT_WELCOME_EMAIL_SUBJECT, bodyText: DEFAULT_WELCOME_EMAIL_BODY };

/** См. resolveSmtpSettings — та же логика приоритета БД над встроенным дефолтом (здесь запасной
 *  вариант не в .env, письмо не содержит секретов, дефолт — те же константы выше). */
export async function resolveWelcomeEmailSettings() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'welcome_email'");
    const v = rows[0]?.value;
    if (v?.subject && v?.bodyText) return { subject: v.subject, bodyText: v.bodyText };
  } catch (e) {
    console.warn("не удалось прочитать текст приветственного письма из app_settings, использую дефолт:", e?.message ?? e);
  }
  return DEFAULT_WELCOME_EMAIL_SETTINGS;
}

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

/** Абзацы plain-текста из админки (пустая строка — разделитель, см. AdminWelcomeEmailSettings.tsx)
 *  → HTML-параграфы. HTML-экранируем контент, но сам разделитель абзацев и переносы строк внутри
 *  абзаца превращаем в разметку — админ пишет обычный текст, не HTML. */
function textToHtmlParagraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Оформление в стиле платформы (см. src/index.css: --color-ink/paper/sheet/blue/hl) — толстые
 *  2px-рамки вместо теней (в email-клиентах box-shadow ненадёжен, толстая однотонная рамка того
 *  же цвета выглядит везде одинаково), тёмная шапка со звездой-логотипом, синяя CTA-кнопка. Не
 *  редактируется через админку — это дизайн, а не текст (см. DEFAULT_WELCOME_EMAIL_BODY выше про
 *  разделение "что можно поменять" и "что зашито в код"). Таблицы, а не div/flex — надёжнее в
 *  Outlook и почтовых клиентах, которые не умеют современный CSS. */
function wrapBrandedHtml(innerHtml) {
  return `<!doctype html><html lang="ru"><body style="margin:0;padding:28px 12px;background:#f2f3ee;font-family:'Segoe UI',Arial,sans-serif;color:#15172e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fbfbf8;border:2px solid #15172e;">
  <tr>
    <td style="background:#15172e;padding:16px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:30px;height:30px;background:#ffe45e;color:#15172e;text-align:center;font-weight:900;font-size:16px;line-height:30px;">★</td>
        <td style="padding-left:10px;color:#fbfbf8;font-weight:900;font-size:16px;letter-spacing:0.02em;">ЕГЭ·ПРО</td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 24px 8px;">
      ${innerHtml}
    </td>
  </tr>
  <tr>
    <td style="padding:16px 24px 24px;border-top:2px solid #e5e6df;">
      <p style="margin:0;font-size:12px;color:#8a8d9a;">ЕГЭ·ПРО — тренажёр подготовки к ЕГЭ с ИИ-репетитором</p>
    </td>
  </tr>
</table>
</body></html>`;
}

/** Приветственное письмо с советами — уходит один раз, сразу после того как ученик подтвердил
 *  email (см. POST /auth/verify-email в server.js). fullName — необязательно (может не быть
 *  заполнено при регистрации), тогда приветствие обезличенное. siteUrl — для кнопки "Открыть
 *  тренажёр", тот же process.env.CORS_ORIGIN, что и в остальных письмах. subject/bodyText —
 *  необязательный оверрайд поверх сохранённого в БД текста: POST /admin/welcome-email/test в
 *  server.js передаёт сюда то, что сейчас в форме админки (даже ещё не сохранённое) — иначе
 *  тестовое письмо проверяло бы старый текст, а не то, что админ только что напечатал. Best-effort
 *  — вызывающий код сам решает, ловить ли ошибку (см. комментарий у sendMail выше). */
export async function sendWelcomeEmail(to, { fullName, siteUrl, subject: subjectOverride, bodyText: bodyOverride } = {}) {
  const resolved = subjectOverride && bodyOverride ? { subject: subjectOverride, bodyText: bodyOverride } : await resolveWelcomeEmailSettings();
  const { subject, bodyText } = resolved;
  const greeting = fullName?.trim() ? `Привет, ${fullName.trim()}!` : "Привет!";
  const url = siteUrl || "https://ege-tutor.ru";
  await sendMail({
    to,
    subject,
    text: `${greeting}\n\n${bodyText}\n\nОткрыть тренажёр: ${url}`,
    html: wrapBrandedHtml(`
<p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">почта подтверждена</p>
<h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(greeting)}</h2>
${textToHtmlParagraphs(bodyText)}
<p style="margin:24px 0 4px;"><a href="${escapeHtml(url)}" style="background:#2447e9;color:#f4f6ff;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #101b5e;display:inline-block;">Открыть тренажёр →</a></p>
`),
  });
}
