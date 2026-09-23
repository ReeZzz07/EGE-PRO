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
export const DEFAULT_WELCOME_EMAIL_BODY = `ЕГЭ·ПРО — тренажёр для тех, кто готовится к экзамену самостоятельно и хочет реально разбираться в материале, а не запоминать чужие ответы. В отличие от сборников готовых решений и обычных банков заданий, здесь ИИ-репетитор не решает задачи за тебя — он объясняет метод и доводит до последнего шага, а дальше ты доделываешь сам(а). Задания — из открытого банка ФИПИ, то есть именно того формата, что будет на настоящем экзамене.

Начни с диагностики по каждому предмету — 8–12 заданий, 7–10 минут. По результатам сразу строится личный план: что повторить сегодня, а что подождёт до следующей недели, — вместо того чтобы решать всё подряд без разбора.

Занимайся понемногу, но каждый день, а не раз в неделю по три часа. Регулярность даёт лучший результат, чем редкие марафоны — даже 20–30 минут в день ощутимо двигают дело, и это видно на графике прогресса в личном кабинете.

Проси у ИИ-репетитора подсказки по уровням, начиная с первого, — он не выдаёт готовый ответ, а объясняет принцип, чтобы ты дошёл(шла) до решения сам(а) и запомнил(а) метод, а не число. На бесплатном тарифе на это есть суточный лимит обращений — если готовишься по нескольким предметам одновременно, платный тариф снимает это ограничение.

Возвращайся в тетрадь ошибок — она сама собирает туда задания, где ты хоть раз ошибся(лась). Второй проход по своим же ошибкам через день-два закрепляет тему куда лучше, чем ещё десяток новых заданий подряд.

Ближе к экзамену решай варианты в режиме «Пробник» — с таймером и в формате настоящего ЕГЭ. Это тренирует не только знания, но и скорость с нервами: разница между «знаю» и «успеваю за отведённое время» выясняется именно там.

Хочешь готовиться по всем предметам сразу, без дневного лимита ИИ-репетитора и с проверкой сочинений по критериям ФИПИ? На бесплатном тарифе уже открыты русский язык и математика — этого достаточно, чтобы попробовать платформу. Тарифы «Аттестат», «Вуз» и «Вуз+» открывают до 11 предметов и все возможности целиком, от 1990 ₽/мес — посмотри на странице «Тариф», какой подходит именно тебе.

Итог простой: ЕГЭ·ПРО — тренажёр, где искусственный интеллект не подсказывает готовый ответ, а учит его находить, — с реальными заданиями ФИПИ, персональным планом после диагностики и разбором каждой ошибки по шагам. Так баллы получают за понимание, а не за память о чужом решении — и именно поэтому стоит начать сегодня, а не откладывать до последней недели перед экзаменом.`;

// Напоминание об онбординге — отдельный блок, показывается ТОЛЬКО тем, кто его ещё не прошёл (см.
// sendWelcomeEmail: параметр onboarded, POST /auth/verify-email в server.js передаёт его по
// profiles.onboarded_at). Формулировка сознательно перекликается с баннером на главной (см.
// Dashboard.tsx → OnboardingNudge) — тот же смысл, тот же призыв "Заполнить", чтобы ученик узнал
// его, когда вернётся на платформу.
export const DEFAULT_ONBOARDING_REMINDER_TEXT = `Кстати: похоже, ты ещё не заполнил(а) анкету подготовки — класс, год сдачи, цель и время в день. Без неё персональный план и «Пробник» не понимают, по какому предмету и в каком темпе тебя вести, и показывают значения по умолчанию вместо твоих реальных. Это займёт меньше минуты: зайди на платформу — сверху будет напоминание с кнопкой «Заполнить».`;

export const DEFAULT_WELCOME_EMAIL_SETTINGS = {
  subject: DEFAULT_WELCOME_EMAIL_SUBJECT,
  bodyText: DEFAULT_WELCOME_EMAIL_BODY,
  onboardingReminderText: DEFAULT_ONBOARDING_REMINDER_TEXT,
};

/** См. resolveSmtpSettings — та же логика приоритета БД над встроенным дефолтом (здесь запасной
 *  вариант не в .env, письмо не содержит секретов, дефолт — те же константы выше). */
export async function resolveWelcomeEmailSettings() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'welcome_email'");
    const v = rows[0]?.value;
    if (v?.subject && v?.bodyText) {
      return { subject: v.subject, bodyText: v.bodyText, onboardingReminderText: v.onboardingReminderText || DEFAULT_ONBOARDING_REMINDER_TEXT };
    }
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

// Циклические акцентные цвета для нумерованных пунктов ниже — те же, что красят предметные
// значки по всему сайту (SUBJECTS[...].color в src/data/tasks.ts: text-blue/teal/violet/amber/rose),
// здесь просто их hex-эквиваленты, потому что в письме нет доступа к tailwind-токенам.
const TIP_ACCENT_COLORS = ["#2447e9", "#0b7e8c", "#6d28d9", "#d98a0b", "#d1216b"];

function paragraphHtml(text, extraStyle = "") {
  return `<p style="margin:0;font-size:14.5px;line-height:1.6;${extraStyle}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

/** Абзацы plain-текста из админки (пустая строка — разделитель, см. AdminWelcomeEmailSettings.tsx)
 *  → насыщенная HTML-вёрстка: ПЕРВЫЙ абзац — вступление обычным текстом, ПОСЛЕДНИЙ — заключение
 *  обычным текстом, всё, что между ними, — пронумерованные карточки-пункты с цветным значком
 *  (визуально превращает "текст советов" в структурированный список, не трогая ни слова из него;
 *  при ≤2 абзацах структура вступление/пункты/заключение не имеет смысла — просто абзацы подряд).
 *  HTML-экранируем контент, но сам разделитель абзацев и переносы внутри абзаца — в разметку. */
function renderBodyRich(text) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 2) {
    return paragraphs.map((p) => `<div style="margin:0 0 16px;">${paragraphHtml(p)}</div>`).join("\n");
  }

  const intro = paragraphs[0];
  const outro = paragraphs[paragraphs.length - 1];
  const items = paragraphs.slice(1, -1);

  const itemsHtml = items
    .map((p, i) => {
      const color = TIP_ACCENT_COLORS[i % TIP_ACCENT_COLORS.length];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
  <tr>
    <td width="36" style="vertical-align:top;padding-top:1px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:26px;height:26px;background:${color};border:2px solid #15172e;color:#fff;font-weight:900;font-size:13px;text-align:center;line-height:24px;">${i + 1}</td></tr></table>
    </td>
    <td style="vertical-align:top;padding-left:10px;border-left:3px solid ${color};padding-left:14px;">
      ${paragraphHtml(p)}
    </td>
  </tr>
</table>`;
    })
    .join("\n");

  return `<div style="margin:0 0 20px;">${paragraphHtml(intro, "font-size:15px;")}</div>
${itemsHtml}
<div style="margin:20px 0 0;">${paragraphHtml(outro)}</div>`;
}

/** Напоминание об онбординге — отдельный визуальный блок (не карточка-совет, а предупреждение),
 *  вставляется, только когда sendWelcomeEmail вызван с onboarded:false. Тот же приём "пустая
 *  строка — абзац", что и в основном тексте, но каждый абзац просто идёт подряд, без нумерации —
 *  их обычно один-два, не список. */
function renderReminderCallout(text) {
  const paragraphsHtml = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i, arr) => paragraphHtml(p, i < arr.length - 1 ? "margin-bottom:10px;" : ""))
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#fff7de;border:2px solid #d98a0b;">
  <tr><td style="padding:14px 16px;">${paragraphsHtml}</td></tr>
</table>`;
}

/** Оформление в стиле платформы (см. src/index.css: --color-ink/paper/sheet/blue/hl/teal/violet/
 *  amber/rose) — толстые 2px-рамки вместо теней (в email-клиентах box-shadow ненадёжен, толстая
 *  однотонная рамка того же цвета выглядит везде одинаково), жёлтая акцентная полоса + тёмная
 *  шапка с кликабельным логотипом (ведёт на siteUrl), цветные нумерованные карточки советов
 *  (см. renderBodyRich выше), синяя CTA-кнопка. Не редактируется через админку — это дизайн, а
 *  не текст (см. DEFAULT_WELCOME_EMAIL_BODY выше про разделение "что можно поменять" и "что
 *  зашито в код"). Таблицы, а не div/flex для структурных блоков — надёжнее в Outlook и почтовых
 *  клиентах, которые не умеют современный CSS; простые div с margin — только внутри ячеек, это
 *  Outlook уже переваривает нормально. */
function wrapBrandedHtml(innerHtml, siteUrl) {
  return `<!doctype html><html lang="ru"><body style="margin:0;padding:28px 12px;background:#f2f3ee;font-family:'Segoe UI',Arial,sans-serif;color:#15172e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fbfbf8;border:2px solid #15172e;">
  <tr><td style="height:6px;line-height:6px;font-size:0;background:#ffe45e;">&nbsp;</td></tr>
  <tr>
    <td style="background:#15172e;padding:18px 24px;">
      <a href="${escapeHtml(siteUrl)}" style="text-decoration:none;display:inline-block;" target="_blank">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:30px;height:30px;background:#ffe45e;color:#15172e;text-align:center;font-weight:900;font-size:16px;line-height:30px;">★</td>
          <td style="padding-left:10px;color:#fbfbf8;font-weight:900;font-size:16px;letter-spacing:0.02em;">ЕГЭ·ПРО</td>
        </tr></table>
      </a>
    </td>
  </tr>
  <tr>
    <td style="padding:30px 24px 10px;">
      ${innerHtml}
    </td>
  </tr>
  <tr>
    <td style="padding:18px 24px 24px;border-top:2px solid #e5e6df;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#15172e;">Это разовое письмо, не рассылка — больше таких писем от нас не придёт.</p>
      <p style="margin:0;font-size:12px;color:#8a8d9a;">ЕГЭ·ПРО — тренажёр подготовки к ЕГЭ с ИИ-репетитором</p>
    </td>
  </tr>
</table>
</body></html>`;
}

/** Приветственное письмо с советами — уходит один раз, сразу после того как ученик подтвердил
 *  email (см. POST /auth/verify-email в server.js). fullName — необязательно (может не быть
 *  заполнено при регистрации), тогда приветствие обезличенное. siteUrl — для логотипа-ссылки в
 *  шапке и кнопки "Открыть тренажёр", тот же process.env.CORS_ORIGIN, что и в остальных письмах.
 *  onboarded — прошёл ли ученик анкету подготовки (profiles.onboarded_at) НА МОМЕНТ отправки:
 *  false добавляет блок-напоминание (см. renderReminderCallout) — актуально в первую очередь для
 *  тех, кто вышел из мастера регистрации на середине (см. Dashboard.tsx → OnboardingNudge, тот же
 *  сценарий); по умолчанию true — не показываем напоминание, если статус неизвестен, а не наоборот.
 *  subject/bodyText/onboardingReminderText — необязательный оверрайд поверх сохранённого в БД
 *  текста: POST /admin/welcome-email/test в server.js передаёт сюда то, что сейчас в форме
 *  админки (даже ещё не сохранённое) — иначе тестовое письмо проверяло бы старый текст, а не то,
 *  что админ только что напечатал. Best-effort — вызывающий код сам решает, ловить ли ошибку (см.
 *  комментарий у sendMail выше). */
export async function sendWelcomeEmail(
  to,
  { fullName, siteUrl, onboarded = true, subject: subjectOverride, bodyText: bodyOverride, onboardingReminderText: reminderOverride } = {}
) {
  const resolved =
    subjectOverride && bodyOverride
      ? { subject: subjectOverride, bodyText: bodyOverride, onboardingReminderText: reminderOverride || DEFAULT_ONBOARDING_REMINDER_TEXT }
      : await resolveWelcomeEmailSettings();
  const { subject, bodyText, onboardingReminderText } = resolved;
  const greeting = fullName?.trim() ? `Привет, ${fullName.trim()}!` : "Привет!";
  const url = siteUrl || "https://ege-tutor.ru";
  const reminderText = onboarded ? "" : `\n\n${onboardingReminderText}`;
  await sendMail({
    to,
    subject,
    text: `${greeting}\n\n${bodyText}${reminderText}\n\nОткрыть тренажёр: ${url}`,
    html: wrapBrandedHtml(
      `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">почта подтверждена</p>
<h2 style="margin:0 0 18px;font-size:21px;">${escapeHtml(greeting)}</h2>
${renderBodyRich(bodyText)}
${onboarded ? "" : renderReminderCallout(onboardingReminderText)}
<p style="margin:26px 0 4px;"><a href="${escapeHtml(url)}" style="background:#2447e9;color:#f4f6ff;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #101b5e;display:inline-block;">Открыть тренажёр →</a></p>
`,
      url
    ),
  });
}
