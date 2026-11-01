// Чеклист готовности к коммерческому запуску для вкладки админки.
// Не раскрывает секреты — только «задано / нет» и мягкие предупреждения.
import { pool } from "./db.js";
import { resolveYookassaSettings } from "./yookassa.js";
import { resolveSmtpSettings } from "./mailer.js";

function jwtLooksWeak(secret) {
  if (!secret) return true;
  if (secret.length < 24) return true;
  if (/change_me|local|test|secret|password|123456/i.test(secret)) return true;
  return false;
}

async function resolveAiKeyPresent() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'ai_provider'");
    const v = rows[0]?.value;
    if (v?.apiKey) return true;
  } catch {
    /* ignore */
  }
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

export async function getLaunchReadiness() {
  const [yookassa, smtp, offer, privacy, entity, aiOk, seo] = await Promise.all([
    resolveYookassaSettings(),
    resolveSmtpSettings(),
    pool.query("select 1 from public.legal_documents where key = 'offer' and length(coalesce(content, '')) > 200 limit 1"),
    pool.query("select 1 from public.legal_documents where key = 'privacy' and length(coalesce(content, '')) > 200 limit 1"),
    pool.query("select data from public.content_blocks where key = 'legalEntity' limit 1"),
    resolveAiKeyPresent(),
    pool.query("select value from public.app_settings where key = 'seo' limit 1"),
  ]);

  const entityData = entity.rows[0]?.data ?? {};
  const seoVal = seo.rows[0]?.value && typeof seo.rows[0].value === "object" ? seo.rows[0].value : {};
  const siteUrl = process.env.CORS_ORIGIN || process.env.VITE_SITE_URL || "";
  const siteOk = /^https:\/\//i.test(siteUrl) && !/localhost|127\.0\.0\.1/i.test(siteUrl);

  const items = [
    {
      id: "jwt",
      title: "JWT_SECRET",
      ok: !jwtLooksWeak(process.env.JWT_SECRET),
      detail: jwtLooksWeak(process.env.JWT_SECRET) ? "Слабый или дефолтный секрет — смени в .env перед продом" : "Задан и выглядит достаточно длинным",
    },
    {
      id: "site",
      title: "Прод-домен (CORS / SITE)",
      ok: siteOk,
      detail: siteOk ? siteUrl : "Нужен https://твой-домен в CORS_ORIGIN (не localhost)",
    },
    {
      id: "yookassa",
      title: "ЮKassa",
      ok: !!(yookassa?.shopId && yookassa?.secretKey),
      detail: yookassa?.shopId ? "shopId задан в админке или .env" : "Заполни shopId и secretKey в /admin → Тарифы",
    },
    {
      id: "smtp",
      title: "SMTP (письма)",
      ok: !!smtp,
      detail: smtp ? `SMTP: ${smtp.host}` : "Заполни почту в /admin → Почта",
    },
    {
      id: "offer",
      title: "Публичная оферта",
      ok: !!offer.rows[0],
      detail: offer.rows[0] ? "Текст оферты заполнен" : "Нужен текст в /admin → Юридические",
    },
    {
      id: "privacy",
      title: "Политика конфиденциальности",
      ok: !!privacy.rows[0],
      detail: privacy.rows[0] ? "Текст политики заполнен" : "Нужен текст в /admin → Юридические",
    },
    {
      id: "entity",
      title: "Реквизиты ИП (ИНН/ОГРНИП)",
      ok: !!(entityData.inn && entityData.ogrnip),
      detail: entityData.inn && entityData.ogrnip ? `ИНН ${entityData.inn}` : "Заполни в /admin → Контент лендинга → юрлицо",
    },
    {
      id: "ai",
      title: "Ключ ИИ-репетитора",
      ok: aiOk,
      detail: aiOk ? "Ключ задан (админка или .env)" : "Без ключа — только офлайн-фолбэк; задай в /admin → ИИ-репетитор",
    },
    {
      id: "seo",
      title: "SEO / Метрика",
      ok: !!(seoVal.metrikaId || seoVal.siteUrl),
      detail: seoVal.metrikaId ? "Метрика подключена" : "Опционально: номер Метрики в /admin → SEO",
      optional: true,
    },
  ];

  const required = items.filter((i) => !i.optional);
  const ready = required.every((i) => i.ok);
  return { ready, items };
}
