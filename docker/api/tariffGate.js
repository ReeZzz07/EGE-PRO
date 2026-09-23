// Тарифные и лимитные проверки для ИИ-репетитора — вынесено из server.js в отдельный модуль,
// чтобы можно было протестировать независимо от Express/AI-провайдеров (см. test/tariffGate.test.js).
// Администраторы (см. Tariffs.tsx) тариф игнорируют полностью во всех проверках ниже — не
// ограничены никогда, даже если у них почему-то записан free.
import { pool } from "./db.js";

/** Тариф пользователя в разрезе, нужном ограничениям ИИ-репетитора ниже — один JOIN на оба
 * случая (дневной лимит и доступность проверки сочинений), вместо двух запросов на запрос.
 *
 * tariff_expires_at (см. миграцию 0023_admin_user_management.sql) — если он в прошлом, пользователь
 * для всех целей этой функции откатывается на условия бесплатного тарифа, как будто его платного
 * tariff_id никогда не было: CASE ниже подставляет в JOIN 'free' вместо p.tariff_id в этом случае,
 * а не просто зануляет price_rub/daily_ai_limit — так cache-код тарифа в профиле (для истории/
 * отображения в админке) остаётся прежним, а фактические лимиты честно берутся из актуального
 * бесплатного тарифа (он тоже может меняться админом, см. AdminTariffs.tsx).
 */
export async function resolveUserTariffGate(userId) {
  const { rows } = await pool.query(
    `select p.is_admin, coalesce(t.price_rub, 0) as price_rub, t.daily_ai_limit
     from public.profiles p
     left join public.tariffs t
       on t.id = (case when p.tariff_expires_at is not null and p.tariff_expires_at <= now() then 'free' else p.tariff_id end)
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
 * безлимитных тарифов. Только проверка, ничего не резервирует — см. reserveDailyAiSlot ниже для
 * настоящего гейта перед обращением к модели, и /ai-tutor/quota в server.js, которому здесь
 * достаточно честного "сколько осталось", а не блокировки. */
export async function checkDailyAiLimit(gate, userId) {
  if (gate.isAdmin || gate.dailyAiLimit == null) return { limited: false };
  const used = await countTodayTutorMessages(userId);
  return { limited: used >= gate.dailyAiLimit };
}

/** Проверка лимита и запись сообщения пользователя — атомарно, одной транзакцией с advisory-
 * локом на userId. Раньше проверка (SELECT count) и запись строки, которая эту проверку в
 * следующий раз двигает, были разнесены по разным моментам запроса (проверка — до медленного
 * обращения к модели, запись — после её ответа, см. server.js) и ничем не сериализовались:
 * несколько параллельных запросов от одного пользователя читали один и тот же "старый" count и
 * все проходили проверку разом, позволяя превысить дневной лимит на количество одновременных
 * запросов. Резервируем строку сразу здесь (роль 'user', реальный текст обращения) ДО вызова
 * модели — конкурентный запрос того же пользователя, попавший на advisory-лок следующим, увидит
 * уже увеличившийся count. Лок держится только на время этой короткой транзакции, не на всё время
 * ответа модели — от него блокируются только повторные запросы ЭТОГО ЖЕ пользователя, не все подряд. */
export async function reserveDailyAiSlot(gate, userId, { taskId, mode, content }) {
  if (gate.isAdmin || gate.dailyAiLimit == null) return { limited: false };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
    const { rows } = await client.query(
      `select count(*)::int as n from public.ai_messages
       where user_id = $1 and role = 'user' and mode in ('hint', 'explain_topic', 'chat')
         and created_at >= date_trunc('day', now())`,
      [userId]
    );
    if (rows[0].n >= gate.dailyAiLimit) {
      await client.query("commit");
      return { limited: true };
    }
    const inserted = await client.query(
      `insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,$3,'user',$4) returning id`,
      [userId, taskId ?? null, mode, content ?? ""]
    );
    await client.query("commit");
    // reservationId — чтобы releaseDailyAiSlot ниже мог откатить именно эту резервацию, если сам
    // вызов модели после неё не удался (см. server.js): иначе временный сбой провайдера молча
    // списывал бы ученику одну из его ограниченных попыток на день за ответ, которого не было.
    return { limited: false, reservationId: inserted.rows[0].id };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Откатывает резервацию из reserveDailyAiSlot — вызывается, когда сам запрос к модели после
 * успешной резервации всё же не удался (сеть, таймаут, ошибка провайдера): без этого неудачная
 * попытка всё равно тратила бы дневной лимит, хотя ученик не получил ответа. reservationId может
 * отсутствовать (админ/безлимитный тариф — reserveDailyAiSlot тогда вообще ничего не резервирует),
 * тогда откатывать нечего. */
export async function releaseDailyAiSlot(reservationId) {
  if (reservationId == null) return;
  await pool.query("delete from public.ai_messages where id = $1", [reservationId]).catch((e) => console.warn("releaseDailyAiSlot failed", e));
}

/** Проверка сочинений и развёрнутых ответов по критериям — платная функция (priceRub > 0),
 * бесплатный тариф её не получает вовсе (см. EssayView.tsx/MockExam.tsx на фронтенде —
 * useEssayCheckAllowed там дублирует то же условие для честной пометки в UI до обращения к API). */
export function isEssayCheckAllowed(gate) {
  return gate.isAdmin || gate.priceRub > 0;
}

/** Сколько раз бесплатный тариф может попробовать проверку сочинения (за всё время, не в день):
 * одна проверка показывает главную платную ценность вживую, а стоит одного вызова модели. Числом
 * не злоупотребить: считаем реально выполненные проверки (неудачные вызовы модели откатываются —
 * см. releaseEssayCheckSlot и в счёт не идут). */
export const FREE_ESSAY_TRIALS = 1;

/** Осталось бесплатных проверок; для платных тарифов и админов не применимо (их пускает
 * isEssayCheckAllowed) — возвращаем 0, чтобы вызывающий код не путал «пробную» и «платную» ветку. */
export async function essayTrialLeft(gate, userId) {
  if (isEssayCheckAllowed(gate)) return 0;
  const { rows } = await pool.query(
    "select count(*)::int as n from public.ai_messages where user_id = $1 and role = 'user' and mode = 'check_essay'",
    [userId]
  );
  return Math.max(0, FREE_ESSAY_TRIALS - rows[0].n);
}

/** Не тарифный лимит (в отличие от dailyAiLimit — тот вообще не действует на check_essay, см.
 * countTodayTutorMessages), а защита от накрутки: isEssayCheckAllowed выше — это бинарный доступ
 * "платный тариф = без числового лимита", но "без лимита" не должно означать "без потолка вообще" —
 * иначе цикл запись→автора расшифровка→отправка в EssayView (см. ReadAloudView/useVoiceRecorder,
 * запись голосом снижает трение для повторной отправки сильнее, чем печать вручную) даёт дешёвый
 * способ прогнать платный ИИ-провайдер (Claude/Qwen) в цикле без реального ограничения. Формально
 * этот трафик уже проходит через aiTutorLimiter (20 запросов/мин на IP, см. server.js), но это
 * ограничение на минуту, а не на день, и не защищает конкретно одного пользователя. Число щедрое —
 * реальному ученику, даже усердно переписывающему черновики, столько за день не нужно.
 */
const DAILY_ESSAY_CHECK_LIMIT = 40;

/** Тот же паттерн, что у reserveDailyAiSlot выше (advisory-лок + резервация строки ДО обращения к
 * модели, атомарно с проверкой) — иначе несколько параллельных check_essay от одного пользователя
 * читали бы один и тот же "старый" count и все проходили бы проверку разом, как и с hint/chat. */
export async function reserveEssayCheckSlot(gate, userId, { taskId, content }) {
  if (gate.isAdmin) return { limited: false };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`essay:${userId}`]);
    const { rows } = await client.query(
      `select count(*)::int as n from public.ai_messages
       where user_id = $1 and role = 'user' and mode = 'check_essay'
         and created_at >= date_trunc('day', now())`,
      [userId]
    );
    if (rows[0].n >= DAILY_ESSAY_CHECK_LIMIT) {
      await client.query("commit");
      return { limited: true };
    }
    const inserted = await client.query(
      `insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,'check_essay','user',$3) returning id`,
      [userId, taskId ?? null, content ?? ""]
    );
    await client.query("commit");
    return { limited: false, reservationId: inserted.rows[0].id };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Откатывает резервацию из reserveEssayCheckSlot, если сам вызов модели после неё не удался —
 * тот же смысл, что у releaseDailyAiSlot: неудачная попытка не должна стоить ученику одной из его
 * (щедрых, но конечных) проверок на день. */
export async function releaseEssayCheckSlot(reservationId) {
  if (reservationId == null) return;
  await pool.query("delete from public.ai_messages where id = $1", [reservationId]).catch((e) => console.warn("releaseEssayCheckSlot failed", e));
}
