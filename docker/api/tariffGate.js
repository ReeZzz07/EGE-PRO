// Тарифные и лимитные проверки для ИИ-репетитора — вынесено из server.js в отдельный модуль,
// чтобы можно было протестировать независимо от Express/AI-провайдеров (см. test/tariffGate.test.js).
// Администраторы (см. Tariffs.tsx) тариф игнорируют полностью во всех проверках ниже — не
// ограничены никогда, даже если у них почему-то записан free.
import { pool } from "./db.js";

/** Тариф пользователя в разрезе, нужном ограничениям ИИ-репетитора ниже — один JOIN на оба
 * случая (дневной лимит и доступность проверки сочинений), вместо двух запросов на запрос. */
export async function resolveUserTariffGate(userId) {
  const { rows } = await pool.query(
    `select p.is_admin, coalesce(t.price_rub, 0) as price_rub, t.daily_ai_limit
     from public.profiles p
     left join public.tariffs t on t.id = p.tariff_id
     where p.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return { isAdmin: false, priceRub: 0, dailyAiLimit: null };
  return { isAdmin: row.is_admin, priceRub: row.price_rub, dailyAiLimit: row.daily_ai_limit };
}

/** Сколько раз сегодня (по UTC) пользователь уже обращался к репетитору в режимах
 * hint/explain_topic/chat — реальные обращения; проверку сочинений (check_essay) не считаем,
 * у неё свой гейт (см. isEssayCheckAllowed), это не то, что подразумевается под "обращением к
 * ИИ-репетитору" в описании тарифов. */
export async function countTodayTutorMessages(userId) {
  const { rows } = await pool.query(
    `select count(*)::int as n from public.ai_messages
     where user_id = $1 and role = 'user' and mode in ('hint', 'explain_topic', 'chat')
       and created_at >= date_trunc('day', now())`,
    [userId]
  );
  return rows[0].n;
}

/** Дневной лимит ИИ-обращений тарифа пользователя (public.tariffs.daily_ai_limit) — null у
 * безлимитных тарифов. */
export async function checkDailyAiLimit(gate, userId) {
  if (gate.isAdmin || gate.dailyAiLimit == null) return { limited: false };
  const used = await countTodayTutorMessages(userId);
  return { limited: used >= gate.dailyAiLimit };
}

/** Проверка сочинений и развёрнутых ответов по критериям — платная функция (priceRub > 0),
 * бесплатный тариф её не получает вовсе (см. EssayView.tsx/MockExam.tsx на фронтенде —
 * useEssayCheckAllowed там дублирует то же условие для честной пометки в UI до обращения к API). */
export function isEssayCheckAllowed(gate) {
  return gate.isAdmin || gate.priceRub > 0;
}
