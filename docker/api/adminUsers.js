// Управление пользователями из админки (просмотр/поиск, правка, персональная скидка, экспорт и
// удаление/анонимизация персональных данных — см. supabase/migrations/0023_admin_user_management.sql
// и требования 152-ФЗ к работе с персональными данными). Вынесено из server.js в отдельный модуль
// по тому же принципу, что tariffGate.js — чистая бизнес-логика, легко тестируемая без Express.
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";

/** Таблицы с прямым user_id, которые нужно включить в выгрузку персональных данных пользователя
 * (см. exportUserData). essay_assessments сюда не входит — она ссылается на essay_submissions
 * через submission_id, без собственного user_id (см. запрос в exportUserData ниже). Это фиксированный
 * список имён таблиц из кода, не пользовательский ввод — интерполяция в SQL ниже безопасна. */
const USER_DATA_TABLES = ["profile_subjects", "attempts", "diagnostics", "study_plans", "essay_submissions", "ai_messages", "hints_used", "exam_attempts", "topic_reviews"];

export async function logAdminAction(adminId, targetUserId, targetEmail, action, details = {}) {
  await pool.query(
    `insert into public.admin_user_actions (admin_id, target_user_id, target_email, action, details) values ($1, $2, $3, $4, $5)`,
    [adminId, targetUserId, targetEmail, action, JSON.stringify(details)]
  );
}

export async function getUserEmail(id) {
  const { rows } = await pool.query("select email from auth.users where id = $1", [id]);
  return rows[0]?.email ?? null;
}

// ─────────────── фильтры списка пользователей ───────────────
// Каждый булев фильтр — SQL-выражение «у пользователя есть X». Значение "yes" берёт выражение как есть,
// "no" — его отрицание (инверсия): список получается ровно противоположным. Выражения никогда не
// возвращают NULL (exists / is not null), поэтому NOT (...) не теряет строк.
const BOOL_EXPR = {
  confirmed: "u.email_confirmed_at is not null",
  onboarded: "p.onboarded_at is not null",
  diagnostic: "exists (select 1 from public.diagnostics d where d.user_id = u.id)",
  first_task: "exists (select 1 from public.attempts a where a.user_id = u.id)",
  ai_request: "exists (select 1 from public.ai_messages m where m.user_id = u.id and m.role = 'user')",
  paid: "exists (select 1 from public.payments pay where pay.user_id = u.id and pay.status = 'succeeded')",
  // начал оплату (платёж создан, но не оплачен/отменён) и ни разу не заплатил
  abandoned:
    "(exists (select 1 from public.payments pa where pa.user_id = u.id and pa.status in ('pending', 'canceled')) and not exists (select 1 from public.payments pb where pb.user_id = u.id and pb.status = 'succeeded'))",
};
export const USER_BOOL_FILTERS = Object.keys(BOOL_EXPR);

const SORT_COLUMNS = {
  registered: "u.created_at",
  name: "lower(p.full_name)",
  email: "u.email",
  tariff: "p.tariff_id",
};

// служебные символы LIKE (% и _) в поисковой строке ищем буквально; экранирующий символ — «!»
// (не обратный слэш: так проще и не зависит от настройки standard_conforming_strings)
const escapeLike = (s) => s.replace(/[!%_]/g, (c) => "!" + c);

/** filters — { confirmed: "yes"|"no"|undefined, ..., region: "Москва", regionNot: true, city, cityNot }.
 *  Неизвестные значения игнорируются — фильтр просто не применяется. Все значения идут параметрами. */
export function buildUserWhere({ q, filters = {} }) {
  const conds = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const term = (q ?? "").trim();
  if (term) {
    const like = add(`%${escapeLike(term)}%`);
    conds.push(`(u.id::text ilike ${like} escape '!' or u.email ilike ${like} escape '!' or p.full_name ilike ${like} escape '!')`);
  }

  for (const key of USER_BOOL_FILTERS) {
    const v = filters[key];
    if (v === "yes") conds.push(`(${BOOL_EXPR[key]})`);
    else if (v === "no") conds.push(`not (${BOOL_EXPR[key]})`);
  }

  for (const [key, col] of [["region", "p.region"], ["city", "p.city"]]) {
    const value = typeof filters[key] === "string" ? filters[key].trim().slice(0, 200) : "";
    if (!value) continue;
    const ph = add(value);
    // «не из региона/города X» включает и тех, у кого поле не заполнено (is distinct from)
    conds.push(filters[`${key}Not`] ? `lower(${col}) is distinct from lower(${ph})` : `lower(${col}) = lower(${ph})`);
  }

  return { where: conds.length ? `where ${conds.join(" and ")}` : "", params };
}

/** Список/поиск для таблицы админки: поиск по id, email и имени (ilike), булевы фильтры воронки с
 * инверсией, фильтр по региону/городу, сортировка. Каждая строка несёт флаги воронки (подтвердил почту,
 * онбординг, диагностика, первая задача, первый запрос к ИИ, оплата, брошенная оплата) — они рисуются
 * значками в колонках. tariff_active — платный тариф, действующий прямо сейчас (не free и срок либо не
 * задан, либо ещё не истёк, см. resolveUserTariffGate в tariffGate.js — та же логика "истёк = как будто
 * free", тут для отображения в списке). */
export async function searchUsers({ q, filters = {}, sort = "registered", dir = "desc", page = 0, pageSize = 25 }) {
  const { where, params } = buildUserWhere({ q, filters });
  const orderCol = SORT_COLUMNS[sort] ?? SORT_COLUMNS.registered;
  const orderDir = dir === "asc" ? "asc" : "desc";
  const { rows } = await pool.query(
    `select u.id, u.email, u.created_at as registered_at, p.full_name, p.tariff_id, p.tariff_expires_at,
            p.is_admin, p.discount_percent, p.anonymized_at, p.region, p.city,
            (p.tariff_id <> 'free' and (p.tariff_expires_at is null or p.tariff_expires_at > now())) as tariff_active,
            ${USER_BOOL_FILTERS.map((k) => `(${BOOL_EXPR[k]}) as ${k}`).join(", ")}
     from auth.users u
     join public.profiles p on p.id = u.id
     ${where}
     order by ${orderCol} ${orderDir} nulls last, u.id
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, pageSize, page * pageSize]
  );
  const { rows: countRows } = await pool.query(`select count(*)::int as n from auth.users u join public.profiles p on p.id = u.id ${where}`, params);
  const { rows: allRows } = await pool.query("select count(*)::int as n from public.profiles");
  return { rows, total: countRows[0].n, overall: allRows[0].n };
}

/** Регионы и города, которые реально встречаются у пользователей — для выпадающих списков фильтра. */
export async function getUserFacets() {
  const regions = await pool.query(
    "select region as value, count(*)::int as count from public.profiles where coalesce(region, '') <> '' group by region order by count desc, region limit 200"
  );
  const cities = await pool.query(
    "select city as value, region, count(*)::int as count from public.profiles where coalesce(city, '') <> '' group by city, region order by count desc, city limit 500"
  );
  return { regions: regions.rows, cities: cities.rows };
}

/** Полная карточка пользователя для админки — профиль + тариф + список предметов. Не путать с
 * exportUserData ниже: это витрина для UI (только то, что нужно показать сразу), экспорт —
 * полная выгрузка ВСЕХ персональных данных по запросу субъекта (включая тексты сочинений, чат с
 * ИИ и т.п.), их не нужно тащить в основную карточку. */
export async function getUserDetail(id) {
  const { rows } = await pool.query(
    `select u.id, u.email, u.created_at as registered_at, u.email_confirmed_at,
            p.full_name, p.grade, p.exam_year, p.goal, p.daily_minutes, p.primary_subject, p.onboarded_at, p.avatar_url,
            p.region, p.city, p.school, p.age, p.gender,
            p.is_admin, p.tariff_id, p.tariff_activated_at, p.tariff_expires_at, p.extra_subjects, p.discount_percent,
            p.anonymized_at, t.name as tariff_name, t.price_rub as tariff_price_rub,
            (p.tariff_id <> 'free' and (p.tariff_expires_at is null or p.tariff_expires_at > now())) as tariff_active
     from auth.users u
     join public.profiles p on p.id = u.id
     left join public.tariffs t on t.id = p.tariff_id
     where u.id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  const { rows: subjects } = await pool.query("select subject, added_at from public.profile_subjects where user_id = $1 order by added_at", [id]);
  // сводка активности — то, что стоит за флагами воронки в списке: когда началась работа с платформой
  const one = async (sql) => (await pool.query(sql, [id])).rows[0];
  const attempts = await one("select count(*)::int as count, min(created_at) as first_at, max(created_at) as last_at from public.attempts where user_id = $1");
  const diagnostics = await one("select count(*)::int as count, min(finished_at) as first_at from public.diagnostics where user_id = $1");
  const ai = await one("select count(*)::int as count, min(created_at) as first_at from public.ai_messages where user_id = $1 and role = 'user'");
  const { rows: payments } = await pool.query(
    "select id, tariff_id, amount_rub, status, kind, extra_subjects, created_at from public.payments where user_id = $1 order by created_at desc limit 10",
    [id]
  );
  return { ...row, subjects, activity: { attempts, diagnostics, ai }, payments };
}

/** patch — любое подмножество { fullName, email, tariffId, tariffExpiresAt, discountPercent,
 * isAdmin }, отсутствующие ключи не трогаются. Смена tariffId сама выставляет tariff_activated_at =
 * now() — так админ не обязан помнить об этом отдельным полем при каждой выдаче/продлении тарифа. */
export async function updateUser(id, patch) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (patch.email !== undefined) {
      const dup = await client.query("select id from auth.users where email = $1 and id <> $2", [patch.email, id]);
      if (dup.rows.length) {
        await client.query("rollback");
        return { error: "Этот email уже занят другим аккаунтом" };
      }
      await client.query("update auth.users set email = $2 where id = $1", [id, patch.email]);
    }

    const sets = [];
    const params = [id];
    const set = (col, value) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.fullName !== undefined) set("full_name", patch.fullName);
    if (patch.isAdmin !== undefined) set("is_admin", patch.isAdmin);
    if (patch.discountPercent !== undefined) set("discount_percent", patch.discountPercent);
    if (patch.tariffExpiresAt !== undefined) set("tariff_expires_at", patch.tariffExpiresAt);
    if (patch.tariffId !== undefined) {
      set("tariff_id", patch.tariffId);
      set("tariff_activated_at", new Date());
    }
    if (sets.length) {
      await client.query(`update public.profiles set ${sets.join(", ")} where id = $1`, params);
    }

    await client.query("commit");
    return {};
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { error: String(e?.message ?? e) };
  } finally {
    client.release();
  }
}

/** Полная выгрузка персональных данных пользователя — ответ на запрос субъекта данных (152-ФЗ).
 * Всё, что где-либо ссылается на его user_id/id, включая тексты сочинений и переписку с
 * ИИ-репетитором. Файл аватарки сюда не входит (бинарник, не текстовые персональные данные в
 * БД) — только сам storage_path, по нему уже видно, что он существует. */
export async function exportUserData(id) {
  const { rows: userRows } = await pool.query("select id, email, raw_user_meta_data, email_confirmed_at, created_at from auth.users where id = $1", [id]);
  if (!userRows[0]) return null;
  const { rows: profileRows } = await pool.query("select * from public.profiles where id = $1", [id]);

  // order by id, не created_at — topic_reviews (см. 0021_topic_reviews.sql) не имеет created_at
  // вовсе (только updated_at), а id как identity-столбец есть у каждой таблицы из списка и сам по
  // себе даёт тот же хронологический порядок.
  const tables = {};
  for (const table of USER_DATA_TABLES) {
    const { rows } = await pool.query(`select * from public.${table} where user_id = $1 order by id`, [id]);
    tables[table] = rows;
  }
  const { rows: assessments } = await pool.query(
    `select ea.* from public.essay_assessments ea
     join public.essay_submissions es on es.id = ea.submission_id
     where es.user_id = $1
     order by ea.id`,
    [id]
  );

  return { exportedAt: new Date().toISOString(), account: userRows[0], profile: profileRows[0] ?? null, essay_assessments: assessments, ...tables };
}

/** Анонимизация — альтернатива полному удалению (deleteUserCascade ниже), когда нужно сохранить
 * агрегатные строки (попытки, диагностику) для статистики, но стереть всё, что идентифицирует
 * конкретного человека: email, имя, аватар, тексты сочинений и переписки с ИИ. Пароль заменяется
 * на случайный (bcrypt-хеш от randomUUID — сам пароль никому не известен и не нужен), token_version
 * увеличивается, чтобы уже выданные токены сразу отозвались — войти в аккаунт после этого нельзя.
 * anonymized_at фиксирует момент — по нему UI показывает аккаунт как анонимизированный. */
export async function anonymizeUser(id) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const passwordHash = await bcrypt.hash(randomUUID(), 10);
    await client.query("update auth.users set email = $2, encrypted_password = $3, raw_user_meta_data = '{}'::jsonb where id = $1", [
      id,
      `deleted-${id}@deleted.local`,
      passwordHash,
    ]);
    await client.query(
      "update public.profiles set full_name = null, avatar_url = null, anonymized_at = now(), token_version = token_version + 1 where id = $1",
      [id]
    );
    await client.query("update public.essay_submissions set text = $2 where user_id = $1", [id, "[удалено по запросу пользователя]"]);
    await client.query("update public.ai_messages set content = $2 where user_id = $1", [id, "[удалено по запросу пользователя]"]);
    await client.query("commit");
    return {};
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { error: String(e?.message ?? e) };
  } finally {
    client.release();
  }
}

/** Полное удаление аккаунта, инициированное админом (та же логика, что у самостоятельного
 * DELETE /auth/account в server.js — единственная разница в том, кто инициирует и что не требуется
 * пароль). Каскад по внешним ключам на auth.users уносит профиль, предметы, попытки, диагностику,
 * план, сочинения, чат с ИИ — см. supabase/migrations/*.sql, "on delete cascade" везде, где есть
 * user_id. Файл аватарки НЕ каскадируется (живёт на диске, не в БД) — чистит вызывающий код в
 * server.js, как и в self-delete, до вызова этой функции. */
export async function deleteUserCascade(id) {
  await pool.query("delete from auth.users where id = $1", [id]);
}
