// Обёртка над ЮKassa Payments API (https://yookassa.ru/developers/api) — разовые платежи с
// редиректом на страницу подтверждения (3-D Secure/банк), без сохранённых карт и автосписаний
// (см. миграцию 0024_payments.sql — почему это отдельные строки, а не подписка). Настройки
// (shopId/secretKey) — тот же паттерн, что у resolveAiSettings в server.js: public.app_settings,
// редактируется в /admin → Тарифы, .env — запасной вариант, если админ ещё не сохранил в БД.
import { pool } from "./db.js";

const YOOKASSA_API = "https://api.yookassa.ru/v3";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`ЮKassa не ответила за ${FETCH_TIMEOUT_MS / 1000}с`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function authHeader(shopId, secretKey) {
  return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;
}

/** См. resolveAiSettings в server.js — тот же принцип: сохранённая в БД настройка приоритетнее
 *  .env, чтобы админ мог сменить магазин/ключ без пересборки и рестарта контейнера. */
export async function resolveYookassaSettings() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'yookassa'");
    const v = rows[0]?.value;
    if (v?.shopId && v?.secretKey) return { shopId: v.shopId, secretKey: v.secretKey };
  } catch (e) {
    console.warn("не удалось прочитать настройки ЮKassa из app_settings, использую .env:", e?.message ?? e);
  }
  if (process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY) {
    return { shopId: process.env.YOOKASSA_SHOP_ID, secretKey: process.env.YOOKASSA_SECRET_KEY };
  }
  return null;
}

// Чек обязателен по 54-ФЗ — без него ЮKassa отвечает 400 "Receipt is missing or illegal" и платёж
// не создаётся вовсе (проверено на живом магазине). vat_code=1 — "без НДС": ИП на УСН «доходы» НДС
// не платит. Если налоговый режим сменится (например, на ОСНО с реальной ставкой) — поменять
// только здесь.
const VAT_CODE_NO_VAT = 1;

/** Создаёt платёж с подтверждением через редирект — возвращает { id, status, confirmationUrl }.
 *  idempotenceKey обязателен для ЮKassa (заголовок Idempotence-Key): повторный запрос с тем же
 *  ключом (например, из-за ретрая на сетевой сбой) возвращает тот же платёж, а не создаёт второй
 *  и не списывает деньги дважды. */
export async function createYookassaPayment({ shopId, secretKey }, { amountRub, description, returnUrl, metadata, idempotenceKey, customerEmail }) {
  const amountValue = amountRub.toFixed(2);
  const resp = await fetchWithTimeout(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(shopId, secretKey),
      "Idempotence-Key": idempotenceKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: { value: amountValue, currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: returnUrl },
      description,
      metadata,
      receipt: {
        customer: { email: customerEmail },
        items: [
          {
            description: description.slice(0, 128), // лимит ЮKassa на текст позиции в чеке
            quantity: "1.00",
            amount: { value: amountValue, currency: "RUB" },
            vat_code: VAT_CODE_NO_VAT,
            payment_mode: "full_payment",
            payment_subject: "service",
          },
        ],
      },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`ЮKassa create payment ${resp.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return { id: data.id, status: data.status, confirmationUrl: data.confirmation?.confirmation_url };
}

/** Перечитывает платёж НАПРЯМУЮ у ЮKassa по его id — используется и вебхуком (см. server.js
 *  POST /payments/yookassa/webhook), и статус-эндпоинтом для фронтенда. Вебхуку нельзя доверять
 *  напрямую (тело может подделать кто угодно, кто знает URL эндпоинта — ЮKassa не подписывает
 *  вебхуки общим секретом, который можно было бы проверить локально), поэтому реальный статус
 *  всегда переспрашивается здесь, у самой ЮKassa, авторизованным запросом с нашим secretKey. */
export async function fetchYookassaPayment({ shopId, secretKey }, paymentId) {
  const resp = await fetchWithTimeout(`${YOOKASSA_API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader(shopId, secretKey) },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`ЮKassa get payment ${resp.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return { id: data.id, status: data.status, metadata: data.metadata ?? {} };
}
