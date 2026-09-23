// Письма-напоминания (см. lifecycle.js): напоминание неактивным, брошенная оплата, скорое окончание
// и окончание платного тарифа. Тема и текст каждого — редактируются в /admin → Почта (public.app_settings,
// ключ 'lifecycle_emails'); оформление (шапка, рамки, нумерованные пункты, кнопка, карточка состава)
// зашито в код и одинаково с приветственным письмом (см. wrapBrandedHtml в mailer.js).
//
// В тексте можно использовать подстановки в фигурных скобках — {имя}, {тариф}, {дата} и т.д. (список у
// каждого письма свой, см. TEMPLATES ниже). Если абзац содержит подстановку, у которой в этот раз нет
// значения (например, {приостановлено} у тех, у кого замороженных предметов нет), весь абзац просто
// не попадает в письмо — так одно письмо честно подходит всем.
import { pool } from "./db.js";
import { escapeHtml, paragraphHtml, renderBodyRich, sendMail, wrapBrandedHtml } from "./mailer.js";

const FOOTER_ONCE = "Это разовое напоминание о твоём аккаунте — повторять его мы не будем.";
// письма о сроке тарифа уходят каждый оплаченный период — пометка «разовое» была бы неправдой
const FOOTER_PERIODIC = "Это служебное напоминание о сроке твоего тарифа — мы присылаем его перед окончанием и после окончания каждого оплаченного периода.";

export const TEMPLATES = {
  activation: {
    title: "Напоминание тем, кто не начал заниматься",
    when: "Через ~сутки после подтверждения почты тем, кто не решил ни одного задания и не делал диагностику. Один раз.",
    eyebrow: "быстрый старт",
    cta: "Пройти диагностику →",
    ctaPath: "",
    rich: true,
    placeholders: ["имя"],
    footer: FOOTER_ONCE,
    subject: "Твой уровень по ЕГЭ — за 7 минут",
    bodyText: `Ты зарегистрировался(лась) в ЕГЭ·ПРО, но ещё не пробовал(а) платформу в деле. Самый быстрый старт — диагностика: около 7 минут, и сразу станет видно, с чего начинать.

Ответь на 8–12 заданий из открытого банка ФИПИ по предмету, который выбрал(а) при регистрации.

Получи свой уровень: сильные и слабые темы и ориентировочный балл.

Открой личный план: что повторить сегодня и на этой неделе — без хаоса и решения всего подряд.

Это бесплатно и без обязательств. Если пойдёт — ИИ-репетитор поможет разобрать слабые темы по шагам, не выдавая готовых ответов.`,
    summary: false,
  },
  abandoned: {
    title: "Оплата не завершена",
    when: "Через 1 час – 3 дня после начатой, но не завершённой оплаты (если человек так и не заплатил). Один раз.",
    eyebrow: "оплата не завершена",
    cta: "Вернуться к тарифам →",
    ctaPath: "/tariffs",
    rich: false,
    placeholders: ["имя", "тариф"],
    footer: FOOTER_ONCE,
    subject: "Оплата тарифа не завершена",
    bodyText: `Ты начал(а) оплату тарифа «{тариф}» на ЕГЭ·ПРО, но платёж не дошёл до конца — с тебя ничего не списано.

Если ты просто отвлёкся(лась), вернись на страницу тарифов и оплати в пару кликов: тариф включается сразу после платежа, чек придёт на почту. Оплата разовая на 30 дней, без автосписаний.`,
    summary: false,
  },
  expiring: {
    title: "Скоро закончится платный тариф",
    when: "За 3 дня до окончания платного тарифа. Один раз на каждый оплаченный период. Кнопка ведёт на /renew — продление с теми же настройками.",
    eyebrow: "скоро конец срока",
    cta: "Продлить с теми же настройками →",
    ctaPath: "/renew",
    rich: false,
    placeholders: ["имя", "тариф", "дата", "дней", "состав", "сумма"],
    footer: FOOTER_PERIODIC,
    subject: "Тариф «{тариф}» заканчивается {дата}",
    bodyText: `Срок твоего тарифа «{тариф}» заканчивается {дата} (осталось дней: {дней}). После этого ИИ-репетитор вернётся к лимиту бесплатного тарифа, а часть предметов будет приостановлена — данные и прогресс сохранятся.

Продли заранее с теми же настройками — новые 30 дней прибавятся к оставшимся. Выбирать тариф и предметы заново не нужно. Оплата разовая, без автосписаний.`,
    summary: true,
  },
  expired: {
    title: "Платный тариф закончился",
    when: "В первые 3 дня после окончания платного тарифа. Один раз на каждый оплаченный период. Кнопка ведёт на /renew.",
    eyebrow: "тариф закончился",
    cta: "Продлить с теми же настройками →",
    ctaPath: "/renew",
    rich: false,
    placeholders: ["имя", "тариф", "дата", "состав", "сумма", "приостановлено"],
    footer: FOOTER_PERIODIC,
    subject: "Тариф «{тариф}» закончился — продли в один клик",
    bodyText: `Срок твоего тарифа «{тариф}» закончился {дата}. Все данные на месте: прогресс, тетрадь ошибок, план и подключённые предметы никуда не делись.

Доступ к части предметов ({приостановлено}) сейчас приостановлен — он вернётся сразу после продления.

Продли с теми же настройками — выбирать тариф и предметы заново не нужно: по кнопке ниже сразу откроется оплата. Оплата разовая, без автосписаний.`,
    summary: true,
  },
};

export const KINDS = Object.keys(TEMPLATES);

/** Значения для предпросмотра и тестовой отправки из админки. */
export const SAMPLE_VARS = {
  имя: "Аня",
  тариф: "ВУЗ",
  дата: "12 октября",
  дней: "3",
  состав: "тариф «ВУЗ» + докупленных предметов: 1",
  сумма: "4 280 ₽",
  приостановлено: "3",
};
const SAMPLE_SUMMARY = { tariffName: "ВУЗ", extraSubjects: 1, amountRub: 4280 };
const SAMPLE_OFFER = { active: true, percent: 30, expiresAt: new Date(Date.now() + 50 * 3600 * 1000).toISOString() };

/** Текст из админки: непустые тема/текст перекрывают дефолт, остальное — по умолчанию. */
export async function resolveLifecycleTemplates() {
  let saved = {};
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'lifecycle_emails'");
    saved = rows[0]?.value ?? {};
  } catch (e) {
    console.warn("не удалось прочитать lifecycle_emails из app_settings, использую дефолты:", e?.message ?? e);
  }
  const out = {};
  for (const kind of KINDS) {
    const t = TEMPLATES[kind];
    const s = saved[kind] ?? {};
    out[kind] = {
      subject: typeof s.subject === "string" && s.subject.trim() ? s.subject : t.subject,
      bodyText: typeof s.bodyText === "string" && s.bodyText.trim() ? s.bodyText : t.bodyText,
      // подвал можно сделать пустым (тогда остаётся только подпись платформы), поэтому важно
      // «строка сохранена», а не «строка непустая»
      footer: typeof s.footer === "string" ? s.footer : t.footer,
    };
  }
  return out;
}

/** Подставляет {имя}-подобные значения. Абзац с подстановкой без значения выбрасывается целиком. */
export function fillBody(text, vars) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = [];
  for (const p of paragraphs) {
    let dropped = false;
    const filled = p.replace(/\{([^{}\s]+)\}/g, (m, key) => {
      if (!(key in vars)) return m;
      const v = vars[key];
      if (v == null || v === "") {
        dropped = true;
        return "";
      }
      return String(v);
    });
    if (!dropped) kept.push(filled);
  }
  return kept;
}

export function fillLine(text, vars) {
  return String(text).replace(/\{([^{}\s]+)\}/g, (m, key) => (key in vars && vars[key] != null ? String(vars[key]) : m)).trim();
}

const rubles = (n) => `${Number(n).toLocaleString("ru-RU")} ₽`;

function offerBlock(offer) {
  if (!offer?.active) return { text: "", html: "" };
  const until = new Date(offer.expiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const text = `На первую оплату тарифа действует скидка −${offer.percent}% — до ${until} (МСК). Применится сама при оплате.`;
  return {
    text: `\n\n${text}`,
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#ffe45e;border:2px solid #15172e;"><tr><td style="padding:11px 14px;font-size:14px;font-weight:700;">${escapeHtml(text)}</td></tr></table>`,
  };
}

/** Карточка «что продлеваем» — данные, а не текст (в админке не редактируется). */
function summaryBlock(summary) {
  if (!summary) return { text: "", html: "" };
  const rows = [
    ["Тариф", summary.tariffName],
    ...(summary.extraSubjects > 0 ? [["Докупленные предметы", String(summary.extraSubjects)]] : []),
    ["К оплате на 30 дней", rubles(summary.amountRub)],
  ];
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#fff;border:2px solid #15172e;">
  <tr><td style="padding:12px 16px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">что продлеваем — те же настройки</td></tr>
  ${rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:6px 16px ${i === rows.length - 1 ? "14px" : "6px"};font-size:14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="color:#8a8d9a;">${escapeHtml(k)}</td><td align="right" style="font-weight:${i === rows.length - 1 ? "900" : "700"};${i === rows.length - 1 ? "font-size:16px;" : ""}">${escapeHtml(v)}</td></tr></table></td></tr>`
    )
    .join("\n  ")}
</table>`;
  return { text: `\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}`, html };
}

/**
 * Собирает письмо: { subject, text, html }.
 * override — { subject, bodyText, footer } из формы админки (даже несохранённые), иначе берётся сохранённое/дефолт.
 * ctx — { siteUrl, offer, summary: { tariffName, extraSubjects, amountRub } }.
 */
export async function buildLifecycleEmail(kind, vars, ctx = {}, override = null) {
  const t = TEMPLATES[kind];
  if (!t) throw new Error(`неизвестный вид письма: ${kind}`);
  const saved = (await resolveLifecycleTemplates())[kind];
  const subjectSrc = override?.subject?.trim() ? override.subject : saved.subject;
  const bodySrc = override?.bodyText?.trim() ? override.bodyText : saved.bodyText;
  const footer = (typeof override?.footer === "string" ? override.footer : saved.footer).trim();

  const base = ctx.siteUrl || "https://ege-tutor.ru";
  const url = `${base}${t.ctaPath}`;
  const name = String(vars.имя ?? "").trim();
  const greeting = name ? `${name}, привет!` : "Привет!";
  const paragraphs = fillBody(bodySrc, vars);
  const bodyHtml = t.rich && paragraphs.length > 2 ? renderBodyRich(paragraphs.join("\n\n")) : paragraphs.map((p) => `<div style="margin:0 0 14px;">${paragraphHtml(p)}</div>`).join("\n");
  const offer = offerBlock(ctx.offer);
  const summary = t.summary ? summaryBlock(ctx.summary) : { text: "", html: "" };

  return {
    subject: fillLine(subjectSrc, vars),
    text: `${greeting}\n\n${paragraphs.join("\n\n")}${summary.text}${offer.text}\n\n${t.cta.replace(/\s*→$/, "")}: ${url}${footer ? `\n\n${footer}` : ""}`,
    html: wrapBrandedHtml(
      `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">${escapeHtml(t.eyebrow)}</p>
<h2 style="margin:0 0 18px;font-size:21px;">${escapeHtml(greeting)}</h2>
${bodyHtml}
${summary.html}
${offer.html}
<p style="margin:26px 0 4px;"><a href="${escapeHtml(url)}" style="background:#2447e9;color:#f4f6ff;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #101b5e;display:inline-block;">${escapeHtml(t.cta)}</a></p>
`,
      base,
      footer
    ),
  };
}

/** Предпросмотр/тест из админки: образцовые данные, скидка показана всегда, чтобы видеть полную версию. */
export async function buildSampleEmail(kind, override) {
  return buildLifecycleEmail(kind, SAMPLE_VARS, { siteUrl: (process.env.CORS_ORIGIN || "").split(",")[0].trim(), offer: SAMPLE_OFFER, summary: SAMPLE_SUMMARY }, override);
}

// ─────────────── отправка (вызывается из lifecycle.js) ───────────────

const dateRu = (iso) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

export async function sendActivationEmail(to, { fullName, siteUrl, offer } = {}) {
  const m = await buildLifecycleEmail("activation", { имя: fullName ?? "" }, { siteUrl, offer });
  await sendMail({ to, ...m });
}

export async function sendPaymentAbandonedEmail(to, { fullName, siteUrl, tariffName, offer } = {}) {
  const m = await buildLifecycleEmail("abandoned", { имя: fullName ?? "", тариф: tariffName }, { siteUrl, offer });
  await sendMail({ to, ...m });
}

/** expired=false — скоро закончится, true — уже закончился. Ссылка ведёт на /renew — продление с теми же
 *  настройками (тариф + докупленные предметы), без повторного выбора. */
export async function sendSubscriptionExpiryEmail(to, { fullName, siteUrl, tariffName, expiresAt, expired, daysLeft, extraSubjects = 0, amountRub, frozenCount = 0 } = {}) {
  const composition = `тариф «${tariffName}»${extraSubjects > 0 ? ` + докупленных предметов: ${extraSubjects}` : ""}`;
  const vars = {
    имя: fullName ?? "",
    тариф: tariffName,
    дата: dateRu(expiresAt),
    дней: daysLeft != null ? String(daysLeft) : "",
    состав: composition,
    сумма: rubles(amountRub),
    приостановлено: frozenCount > 0 ? String(frozenCount) : "",
  };
  const m = await buildLifecycleEmail(expired ? "expired" : "expiring", vars, { siteUrl, summary: { tariffName, extraSubjects, amountRub } });
  await sendMail({ to, ...m });
}
