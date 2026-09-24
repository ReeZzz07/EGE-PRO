// Рассылки из админки: письма пользователям, отобранным тем же фильтром, что и список «Пользователи»
// (см. adminUsers.js → buildUserWhere). Два вида:
//  • verify_link — повторная ссылка подтверждения почты тем, кто её так и не подтвердил (всегда только
//    неподтверждённые, что бы ни стояло в фильтре);
//  • custom — своё письмо-напоминание в оформлении приветственного (тема/текст/кнопка/подвал — при создании).
//
// Защиты от «случайно написали всем»: получателей считает сервер, а админ подтверждает ТОЧНОЕ число
// (confirmCount) — если фильтр за это время изменил выборку, рассылка не создаётся; потолок на одну
// рассылку (MAX_RECIPIENTS); админы, анонимизированные и служебные .local никогда не получают; по умолчанию
// исключаются те, кому рассылка уже уходила за последние RECENT_DAYS дней; отправка идёт по одному письму с
// паузой (SEND_DELAY_MS) в фоне и останавливается кнопкой «Отменить»; каждому получателю письмо — максимум
// один раз (первичный ключ), после падения сервера недосланное НЕ переотправляется (лучше пропустить, чем
// продублировать). Журнал — таблицы email_campaigns / email_campaign_recipients (миграция 0031).
import { pool } from "./db.js";
import { buildUserWhere } from "./adminUsers.js";
import { createActionToken } from "./authTokens.js";
import { buildVerifyEmail, escapeHtml, paragraphHtml, sendMail, sendVerifyEmail, wrapBrandedHtml } from "./mailer.js";
import { fillBody, fillLine } from "./lifecycleEmails.js";

export const MAX_RECIPIENTS = 500;
export const SEND_DELAY_MS = 1200;
export const RECENT_DAYS = 7;
/** Куда ведёт кнопка письма: главная платформы, тарифы, продление тарифа, онбординг (анкета подготовки). */
export const CTA_PATHS = ["", "/tariffs", "/renew", "/onboarding"];
export const KINDS = ["verify_link", "custom"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const siteUrl = () => (process.env.CORS_ORIGIN || "").split(",")[0].trim() || "https://ege-tutor.ru";

const RECENT_EXPR = `not exists (select 1 from public.email_campaign_recipients rr where rr.user_id = u.id and rr.status = 'sent' and rr.sent_at > now() - interval '${RECENT_DAYS} days')`;

/** Приводит фильтры из тела запроса к тому же виду, что принимает buildUserWhere (лишнее отбрасывается). */
export function sanitizeFilters(raw) {
  const f = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const key of ["confirmed", "onboarded", "diagnostic", "first_task", "ai_request", "paid", "abandoned"]) {
    if (src[key] === "yes" || src[key] === "no") f[key] = src[key];
  }
  for (const key of ["region", "city"]) {
    if (typeof src[key] === "string" && src[key].trim()) {
      f[key] = src[key].trim().slice(0, 200);
      f[`${key}Not`] = src[`${key}Not`] === true;
    }
  }
  return f;
}

function recipientsWhere({ q, filters, kind, excludeRecent }) {
  const { where, params } = buildUserWhere({ q, filters });
  const extra = ["not p.is_admin", "p.anonymized_at is null", "u.email not like '%.local'"];
  if (kind === "verify_link") extra.push("u.email_confirmed_at is null");
  if (excludeRecent) extra.push(RECENT_EXPR);
  return { where: where ? `${where} and ${extra.join(" and ")}` : `where ${extra.join(" and ")}`, params };
}

/** Сколько человек получит рассылку + пример получателей + сколько исключено как «недавно получавшие». */
export async function previewRecipients({ q, filters, kind, excludeRecent = true }) {
  const f = sanitizeFilters(filters);
  const base = { q, filters: f, kind };
  const withEx = recipientsWhere({ ...base, excludeRecent });
  const count = (await pool.query(`select count(*)::int as n from auth.users u join public.profiles p on p.id = u.id ${withEx.where}`, withEx.params)).rows[0].n;
  let excludedRecent = 0;
  if (excludeRecent) {
    const noEx = recipientsWhere({ ...base, excludeRecent: false });
    const all = (await pool.query(`select count(*)::int as n from auth.users u join public.profiles p on p.id = u.id ${noEx.where}`, noEx.params)).rows[0].n;
    excludedRecent = all - count;
  }
  const { rows: sample } = await pool.query(
    `select u.id, u.email, p.full_name from auth.users u join public.profiles p on p.id = u.id ${withEx.where} order by u.created_at desc limit 5`,
    withEx.params
  );
  return { count, overLimit: count > MAX_RECIPIENTS, maxRecipients: MAX_RECIPIENTS, excludedRecent, sample };
}

// ─────────────── содержимое писем ───────────────

export function validateCampaignContent(kind, c) {
  if (!KINDS.includes(kind)) return "Неизвестный вид рассылки";
  if (kind === "verify_link") return null;
  const subject = String(c.subject ?? "").trim();
  const bodyText = String(c.bodyText ?? "").trim();
  if (!subject || !bodyText) return "Заполни тему и текст письма";
  if (subject.length > 200) return "Тема слишком длинная (до 200 символов)";
  if (bodyText.length > 5000) return "Текст слишком длинный (до 5000 символов)";
  if (String(c.eyebrow ?? "").length > 60) return "Метка над приветствием — до 60 символов";
  if (String(c.ctaLabel ?? "").length > 60) return "Текст кнопки — до 60 символов";
  if (String(c.footer ?? "").length > 400) return "Подвал слишком длинный (до 400 символов)";
  if (!CTA_PATHS.includes(String(c.ctaPath ?? ""))) return "Недопустимая ссылка кнопки";
  return null;
}

/** Письмо-напоминание в оформлении приветственного: метка, приветствие по имени, абзацы, кнопка. */
export function buildCampaignEmail(c, { name = "", url = siteUrl() } = {}) {
  const vars = { имя: String(name ?? "").trim() };
  const greeting = vars.имя ? `${vars.имя}, привет!` : "Привет!";
  const paragraphs = fillBody(c.bodyText, vars);
  const ctaLabel = String(c.ctaLabel ?? "").trim() || "Открыть платформу →";
  const link = `${url}${c.ctaPath ?? ""}`;
  const footer = String(c.footer ?? "").trim();
  const eyebrow = String(c.eyebrow ?? "").trim();
  return {
    subject: fillLine(c.subject, vars),
    text: `${greeting}\n\n${paragraphs.join("\n\n")}\n\n${ctaLabel.replace(/\s*→$/, "")}: ${link}${footer ? `\n\n${footer}` : ""}`,
    html: wrapBrandedHtml(
      `
${eyebrow ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#2447e9;">${escapeHtml(eyebrow)}</p>` : ""}
<h2 style="margin:0 0 18px;font-size:21px;">${escapeHtml(greeting)}</h2>
${paragraphs.map((p) => `<div style="margin:0 0 14px;">${paragraphHtml(p)}</div>`).join("\n")}
<p style="margin:26px 0 4px;"><a href="${escapeHtml(link)}" style="background:#2447e9;color:#f4f6ff;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;border:2px solid #101b5e;display:inline-block;">${escapeHtml(ctaLabel)}</a></p>
`,
      url,
      footer
    ),
  };
}

/** Предпросмотр / тест: образцовое имя. Для повторной ссылки подтверждения — то же стандартное письмо, что
 *  реально уйдёт, с образцовой (нерабочей) ссылкой. */
export function renderCampaignSample(kind, c = {}) {
  if (kind === "verify_link") return buildVerifyEmail(`${siteUrl()}/verify-email?token=ОБРАЗЕЦ-ССЫЛКИ`);
  return buildCampaignEmail(c, { name: "Аня" });
}

async function defaultSend(campaign, user) {
  if (campaign.kind === "verify_link") {
    const token = await createActionToken(user.id, "verify_email");
    await sendVerifyEmail(user.email, `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`);
    return;
  }
  const m = buildCampaignEmail(
    { subject: campaign.subject, bodyText: campaign.body_text, eyebrow: campaign.eyebrow, ctaLabel: campaign.cta_label, ctaPath: campaign.cta_path, footer: campaign.footer },
    { name: user.full_name }
  );
  await sendMail({ to: user.email, ...m });
}

// ─────────────── создание и отправка ───────────────

export class CampaignError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** Создаёт рассылку и запускает отправку в фоне. confirmCount — число получателей, которое админ видел и
 *  подтвердил; если сервер насчитал другое, рассылка не создаётся (COUNT_MISMATCH). */
export async function createCampaign({ adminId, kind, subject, bodyText, eyebrow, ctaLabel, ctaPath, footer, filters, q, excludeRecent = true, confirmCount }, opts = {}) {
  const invalid = validateCampaignContent(kind, { subject, bodyText, eyebrow, ctaLabel, ctaPath, footer });
  if (invalid) throw new CampaignError(invalid, "INVALID");
  const f = sanitizeFilters(filters);
  const term = String(q ?? "").trim().slice(0, 200);
  const preview = await previewRecipients({ q: term, filters: f, kind, excludeRecent });
  if (preview.count === 0) throw new CampaignError("По этим условиям получателей нет", "EMPTY");
  if (preview.count > MAX_RECIPIENTS) throw new CampaignError(`Получателей ${preview.count} — больше лимита ${MAX_RECIPIENTS} на одну рассылку. Уточни фильтр.`, "TOO_MANY", { count: preview.count });
  if (Number(confirmCount) !== preview.count) {
    throw new CampaignError(`Число получателей изменилось: теперь ${preview.count}. Проверь и подтверди заново.`, "COUNT_MISMATCH", { count: preview.count });
  }

  const client = await pool.connect();
  let id;
  try {
    await client.query("begin");
    const ins = await client.query(
      `insert into public.email_campaigns (created_by, kind, subject, body_text, eyebrow, cta_label, cta_path, footer, filters, q, exclude_recent, total)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        adminId,
        kind,
        kind === "custom" ? String(subject).trim() : null,
        kind === "custom" ? String(bodyText).trim() : null,
        kind === "custom" ? String(eyebrow ?? "").trim() : null,
        kind === "custom" ? String(ctaLabel ?? "").trim() : null,
        kind === "custom" ? String(ctaPath ?? "") : null,
        kind === "custom" ? String(footer ?? "").trim() : null,
        JSON.stringify(f),
        term || null,
        !!excludeRecent,
        preview.count,
      ]
    );
    id = ins.rows[0].id;
    const { where, params } = recipientsWhere({ q: term, filters: f, kind, excludeRecent });
    // получатели фиксируются снимком в момент создания; кто изменит статус позже — отсеется при отправке
    const inserted = await client.query(
      `insert into public.email_campaign_recipients (campaign_id, user_id)
       select $${params.length + 1}::uuid, u.id from auth.users u join public.profiles p on p.id = u.id ${where}
       order by u.created_at desc limit ${MAX_RECIPIENTS}`,
      [...params, id]
    );
    // между подсчётом и созданием выборка могла измениться — тогда откатываем, а не шлём не тем, кого подтвердили
    if (inserted.rowCount !== preview.count) {
      throw new CampaignError(`Число получателей изменилось: теперь ${inserted.rowCount}. Проверь и подтверди заново.`, "COUNT_MISMATCH", { count: inserted.rowCount });
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // фон: не ждём окончания, ошибки уходят в лог (статусы получателей пишутся в БД)
  runCampaign(id, opts).catch((e) => console.warn("[campaigns] сбой рассылки", id, e?.message ?? e));
  return { id, total: preview.count };
}

const running = new Set();

/** Отправка получателей рассылки по одному: каждый берётся один раз (SKIP LOCKED), состояние получателя
 *  перепроверяется прямо перед отправкой, после каждого реального письма — пауза. Останавливается, когда
 *  получатели кончились или рассылку отменили. */
export async function runCampaign(id, { send = defaultSend, delayMs = SEND_DELAY_MS } = {}) {
  if (running.has(id)) return;
  running.add(id);
  try {
    for (;;) {
      const c = (await pool.query("select * from public.email_campaigns where id = $1", [id])).rows[0];
      if (!c || c.status !== "sending") break;

      const claimed = await pool.query(
        `update public.email_campaign_recipients set status = 'sending'
         where (campaign_id, user_id) = (
           select campaign_id, user_id from public.email_campaign_recipients where campaign_id = $1 and status = 'pending' limit 1 for update skip locked)
         returning user_id`,
        [id]
      );
      if (!claimed.rows[0]) {
        await pool.query("update public.email_campaigns set status = 'done', finished_at = now() where id = $1 and status = 'sending'", [id]);
        break;
      }
      const userId = claimed.rows[0].user_id;
      const setStatus = (status, error = null) =>
        pool.query("update public.email_campaign_recipients set status = $3, error = $4, sent_at = case when $3 = 'sent' then now() else null end where campaign_id = $1 and user_id = $2", [id, userId, status, error]);

      const user = (
        await pool.query(
          "select u.id, u.email, u.email_confirmed_at, p.full_name, p.is_admin, p.anonymized_at from auth.users u join public.profiles p on p.id = u.id where u.id = $1",
          [userId]
        )
      ).rows[0];
      if (!user || user.is_admin || user.anonymized_at || (c.kind === "verify_link" && user.email_confirmed_at)) {
        await setStatus("skipped", !user ? "аккаунт удалён" : c.kind === "verify_link" && user.email_confirmed_at ? "почта уже подтверждена" : "аккаунт больше не подходит");
        continue;
      }
      try {
        await send(c, user);
        await setStatus("sent");
      } catch (e) {
        await setStatus("failed", String(e?.message ?? e).slice(0, 300));
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  } finally {
    running.delete(id);
  }
}

/** Отмена: остановка отправки; неотправленным ставим «пропущено — отменено». Уже ушедшие письма не отозвать. */
export async function cancelCampaign(id) {
  const upd = await pool.query("update public.email_campaigns set status = 'cancelled', finished_at = now() where id = $1 and status = 'sending' returning id", [id]);
  if (!upd.rows[0]) return false;
  await pool.query("update public.email_campaign_recipients set status = 'skipped', error = 'рассылка отменена' where campaign_id = $1 and status = 'pending'", [id]);
  return true;
}

/** При старте сервера: письма, застрявшие в «отправляется» (сервер упал посреди отправки), не переотправляем —
 *  помечаем ошибкой; рассылки, у которых остались получатели в очереди, продолжаем. */
export async function resumeCampaigns(opts = {}) {
  await pool.query("update public.email_campaign_recipients set status = 'failed', error = 'прервано перезапуском сервера' where status = 'sending'");
  const { rows } = await pool.query("select id from public.email_campaigns where status = 'sending'");
  for (const r of rows) runCampaign(r.id, opts).catch((e) => console.warn("[campaigns] сбой рассылки", r.id, e?.message ?? e));
  return rows.length;
}

const COUNTS = `
  count(r.*)::int as total_recipients,
  count(*) filter (where r.status = 'sent')::int as sent,
  count(*) filter (where r.status = 'failed')::int as failed,
  count(*) filter (where r.status = 'skipped')::int as skipped,
  count(*) filter (where r.status in ('pending', 'sending'))::int as pending`;

export async function listCampaigns(limit = 30) {
  const { rows } = await pool.query(
    `select c.id, c.created_at, c.finished_at, c.kind, c.subject, c.status, c.total, c.filters, c.q, c.exclude_recent, u.email as created_by_email, ${COUNTS}
     from public.email_campaigns c
     left join public.email_campaign_recipients r on r.campaign_id = c.id
     left join auth.users u on u.id = c.created_by
     group by c.id, u.email
     order by c.created_at desc limit $1`,
    [limit]
  );
  return rows;
}

export async function getCampaign(id) {
  const { rows } = await pool.query(
    `select c.*, u.email as created_by_email, ${COUNTS}
     from public.email_campaigns c
     left join public.email_campaign_recipients r on r.campaign_id = c.id
     left join auth.users u on u.id = c.created_by
     where c.id = $1 group by c.id, u.email`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: problems } = await pool.query(
    `select au.email, r.status, r.error from public.email_campaign_recipients r join auth.users au on au.id = r.user_id
     where r.campaign_id = $1 and r.status in ('failed', 'skipped') order by r.status, au.email limit 20`,
    [id]
  );
  return { ...rows[0], problems };
}
