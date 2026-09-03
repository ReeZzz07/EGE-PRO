// Заменяет три вещи из облачного Supabase: Auth (GoTrue), Storage API и Edge Function ai-tutor.
// REST (.from()) не портируется сюда — за это отвечает отдельный контейнер postgrest (вызывает
// PostgREST напрямую, он wire-совместим с supabase-js .from()).
import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { safeTaskById, TASK_ANSWERS } from "./safeTasks.js";
import { buildChatPrompt, buildEssaySystemPrompt, buildExplainPrompt, buildHintPrompt, DEFAULT_POLICY } from "./prompt.js";
import { callText, callTool } from "./providers.js";
import { parseImportArchive, readZipFile } from "./importArchive.js";
import { buildTaskAttachments, buildUserContent, supportsVision } from "./taskImages.js";

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET;
// .env — запасной вариант на случай, если админ ещё не сохранил настройку в БД (app_settings,
// вкладка "ИИ-репетитор" в /admin) — см. resolveAiSettings() ниже.
const ENV_FALLBACK_SETTINGS = { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY || "", model: process.env.ANTHROPIC_MODEL || "", baseUrl: "" };
const STORAGE_ROOT = process.env.STORAGE_ROOT || "/data/storage";
if (!JWT_SECRET) throw new Error("JWT_SECRET не задан");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function signToken(user) {
  return jwt.sign({ sub: user.id, role: "authenticated", email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "missing authorization" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const { rows } = await pool.query("select is_admin from public.profiles where id = $1", [req.user.sub]);
    if (!rows[0]?.is_admin) return res.status(403).json({ error: "admin only" });
    next();
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
}

// ─────────────────────── auth ───────────────────────

app.post("/auth/signup", async (req, res) => {
  const { email, password, full_name } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: { message: "email и password обязательны" } });
  try {
    const existing = await pool.query("select id from auth.users where email = $1", [email]);
    if (existing.rows.length) return res.status(400).json({ error: { message: "Пользователь с таким email уже существует" } });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3, now()) returning id, email`,
      [email, hash, JSON.stringify({ full_name: full_name ?? "" })]
    );
    const user = rows[0];
    res.json({ data: { user }, error: null, access_token: signToken(user) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  try {
    const { rows } = await pool.query("select id, email, encrypted_password from auth.users where email = $1", [email]);
    const row = rows[0];
    if (!row || !(await bcrypt.compare(password ?? "", row.encrypted_password))) {
      return res.status(400).json({ error: { message: "Неверный email или пароль" } });
    }
    res.json({ data: { user: { id: row.id, email: row.email } }, error: null, access_token: signToken(row) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

// ─────────────────────── storage ───────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function safeRelPath(bucket, p) {
  const rel = path.normalize(String(p ?? "")).replace(/^([./\\]+)/, "");
  if (rel.includes("..")) throw new Error("недопустимый путь");
  return path.join(STORAGE_ROOT, bucket, rel);
}

app.post("/storage/upload", authMiddleware, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    const { bucket, path: relPath } = req.body;
    if (!bucket || !relPath || !req.file) return res.status(400).json({ error: "bucket, path и file обязательны" });
    const full = safeRelPath(bucket, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, req.file.buffer);
    res.json({ path: relPath });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.post("/storage/remove", authMiddleware, requireAdmin, (req, res) => {
  try {
    const { bucket, paths } = req.body ?? {};
    for (const p of paths ?? []) {
      const full = safeRelPath(bucket, p);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.get("/storage/list", authMiddleware, requireAdmin, (req, res) => {
  try {
    const bucket = String(req.query.bucket ?? "");
    const prefix = String(req.query.prefix ?? "");
    const dir = safeRelPath(bucket, prefix);
    const items = fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => ({ name })) : [];
    res.json({ items });
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

const CONTENT_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** У части файлов из импорта (~126, в основном география) путь пришёл вовсе без расширения —
 *  path.extname() для них пустая строка, CONTENT_TYPES не находит тип, браузер получает
 *  application/octet-stream и не рендерит как картинку. Подсматриваем в первые байты файла. */
function sniffImageContentType(full) {
  try {
    const fd = fs.openSync(full, "r");
    const buf = Buffer.alloc(300);
    const n = fs.readSync(fd, buf, 0, 300, 0);
    fs.closeSync(fd);
    if (n >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (n >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    const ascii6 = buf.toString("ascii", 0, Math.min(6, n));
    if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";
    if (n >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    const head = buf.toString("utf8", 0, n).trimStart().toLowerCase();
    if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  } catch {
    /* ignore */
  }
  return null;
}

app.get("/storage/:bucket/*", (req, res) => {
  try {
    const full = safeRelPath(req.params.bucket, req.params[0]);
    if (!fs.existsSync(full)) return res.status(404).end();
    const byExt = CONTENT_TYPES[path.extname(full).toLowerCase()];
    res.setHeader("content-type", byExt ?? sniffImageContentType(full) ?? "application/octet-stream");
    // без immutable: раньше кеш на год + immutable означал, что однажды закешированный БИТЫЙ
    // ответ (см. содержательный fix выше) браузер не перепроверял вообще ни при каких условиях,
    // включая жёсткий рефреш — из-за immutable часть тегов игнорирует reload-хидеры полностью.
    res.setHeader("cache-control", "public, max-age=31536000");
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// ─────────────────────── ручной импорт заданий (админка) ───────────────────────

const uploadArchive = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const TASK_COLUMNS = [
  "id", "subject", "topic", "section", "ege_number", "answer_type", "bucket", "points", "statement",
  "options", "answer", "explanation", "hints", "criteria", "min_words", "confidence", "needs_review", "published", "source",
];
const JSONB_COLUMNS = new Set(["options", "hints", "criteria"]);

async function upsertTaskRow(row) {
  const cols = TASK_COLUMNS;
  const placeholders = cols.map((c, i) => (JSONB_COLUMNS.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const values = cols.map((c) => (JSONB_COLUMNS.has(c) ? JSON.stringify(row[c] ?? null) : row[c] ?? null));
  const updateSet = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  await pool.query(
    `insert into public.tasks (${cols.join(", ")}) values (${placeholders.join(", ")})
     on conflict (id) do update set ${updateSet}, updated_at = now()`,
    values
  );
}

app.post("/admin/import-archive", authMiddleware, requireAdmin, uploadArchive.single("archive"), async (req, res) => {
  const subject = String(req.body?.subject ?? "");
  if (!subject) return res.status(400).json({ error: "Не указан предмет" });
  if (!req.file) return res.status(400).json({ error: "Файл архива обязателен" });

  let parsed;
  try {
    parsed = parseImportArchive(req.file.buffer, subject);
  } catch (e) {
    return res.status(400).json({ error: `Не удалось разобрать архив: ${e?.message ?? e}` });
  }

  const { rows, mediaByTaskId, zip } = parsed;
  let tasksOk = 0, tasksFailed = 0, mediaOk = 0, mediaFailed = 0;
  const errors = [];

  for (const row of rows) {
    try {
      await upsertTaskRow(row);
      tasksOk++;
    } catch (e) {
      tasksFailed++;
      errors.push(`${row.id}: ${e?.message ?? e}`);
    }
  }

  for (const [taskId, mediaList] of mediaByTaskId) {
    try {
      await pool.query("delete from public.task_media where task_id = $1", [taskId]);
    } catch {
      /* ignore — таблица может быть пуста для этого id */
    }
    for (const m of mediaList) {
      try {
        const bytes = readZipFile(zip, m.zipPath);
        if (!bytes) throw new Error(`файл ${m.zipPath} не найден в архиве`);
        const ext = path.extname(m.zipPath).toLowerCase();
        const storagePath = `manual/${subject}/${taskId}_${m.position}${ext}`;
        const full = safeRelPath("task-media", storagePath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, bytes);
        await pool.query("insert into public.task_media (task_id, storage_path, position) values ($1,$2,$3)", [taskId, storagePath, m.position]);
        mediaOk++;
      } catch (e) {
        mediaFailed++;
        errors.push(`медиа ${taskId}/${m.zipPath}: ${e?.message ?? e}`);
      }
    }
  }

  res.json({
    tasksTotal: rows.length,
    tasksOk,
    tasksFailed,
    published: rows.filter((r) => r.published).length,
    needsReview: rows.filter((r) => !r.published).length,
    mediaOk,
    mediaFailed,
    errors: errors.slice(0, 50),
  });
});

// ─────────────────────── ai-tutor ───────────────────────

function leaksAnswer(text, taskId) {
  if (!taskId) return false;
  const answers = TASK_ANSWERS[taskId];
  if (!answers) return false;
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  return answers.some((a) => {
    const needle = a.toLowerCase().replace(/ё/g, "е");
    if (!needle) return false;
    const re = new RegExp(`(^|[^a-zа-я0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zа-я0-9]|$)`, "i");
    return re.test(normalized);
  });
}

/** Тариф пользователя в разрезе, нужном ограничениям ИИ-репетитора ниже — один JOIN на оба
 * случая (дневной лимит и доступность проверки сочинений), вместо двух запросов на запрос.
 * Администраторы тариф игнорируют полностью (см. Tariffs.tsx) — не ограничены никогда, даже если
 * у них почему-то записан free. */
async function resolveUserTariffGate(userId) {
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
 * у неё свой гейт (см. ниже), это не то, что подразумевается под "обращением к ИИ-репетитору"
 * в описании тарифов. */
async function countTodayTutorMessages(userId) {
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
async function checkDailyAiLimit(gate, userId) {
  if (gate.isAdmin || gate.dailyAiLimit == null) return { limited: false };
  const used = await countTodayTutorMessages(userId);
  return { limited: used >= gate.dailyAiLimit };
}

/** Настройка провайдера/ключа — читается из БД (админка → вкладка "ИИ-репетитор"), .env — запасной
 * вариант, если админ ещё ничего не сохранил. Читаем на каждый запрос — правки в админке применяются
 * сразу, без рестарта контейнера. */
async function resolveAiSettings() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'ai_provider'");
    const v = rows[0]?.value;
    if (v?.apiKey) return { provider: v.provider === "qwen" ? "qwen" : "anthropic", apiKey: v.apiKey, model: v.model || "", baseUrl: v.baseUrl || "" };
  } catch (e) {
    console.warn("не удалось прочитать app_settings, использую .env:", e?.message ?? e);
  }
  return ENV_FALLBACK_SETTINGS;
}

/** Системный промпт (персона + правила + тон) — редактируется в /admin → «ИИ-репетитор»
 * (public.app_settings, ключ ai_system_prompt), читается на КАЖДЫЙ запрос к /ai-tutor, так что
 * правка в админке применяется сразу же, без рестарта контейнера — как и resolveAiSettings() выше. */
async function resolveSystemPrompt() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'ai_system_prompt'");
    const text = rows[0]?.value?.text;
    if (text && text.trim()) return text;
  } catch (e) {
    console.warn("не удалось прочитать системный промпт из app_settings, использую дефолт:", e?.message ?? e);
  }
  return DEFAULT_POLICY;
}

async function callClaudeEssayAssessor(settings, policy, task, essayText) {
  const criteria = task.criteria ?? [];
  const criteriaText = criteria.map((c) => `${c.code} (макс. ${c.max} балл${c.max === 1 ? "" : "ов"}): ${c.name}`).join("\n");
  const userMsg = `Задание (тема: «${task.topic}»):\n${task.statement.join("\n")}\n\nКритерии оценивания:\n${criteriaText}\n\nОтвет ученика:\n"""\n${essayText || "(пусто)"}\n"""\n\nОцени ответ по каждому критерию и вызови submit_assessment.`;

  const tool = {
    name: "submit_assessment",
    description: "Отправить структурированную оценку развёрнутого ответа по критериям",
    input_schema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: { type: "object", properties: { code: { type: "string" }, score: { type: "number" }, comment: { type: "string" } }, required: ["code", "score", "comment"] },
        },
        summary: { type: "string" },
        improvementTips: { type: "array", items: { type: "string" } },
      },
      required: ["criteria", "summary", "improvementTips"],
    },
  };

  const input = await callTool(settings, buildEssaySystemPrompt(policy), userMsg, tool, 1500);
  const clipped = input.criteria.map((c) => {
    const meta = criteria.find((k) => k.code === c.code);
    const max = meta?.max ?? Math.round(c.score);
    return { code: c.code, name: meta?.name ?? c.code, max, score: Math.max(0, Math.min(max, Math.round(c.score))), comment: c.comment };
  });
  const total = clipped.reduce((s, c) => s + c.score, 0);
  const max = clipped.reduce((s, c) => s + c.max, 0);
  return { criteria: clipped, total, max, summary: input.summary, improvementTips: input.improvementTips };
}

/** Задания вне статического курированного списка (массовый импорт) — тянем безопасное
 * подмножество (без answer/explanation) прямо из БД, тем же принципом безопасности. */
async function dbSafeTaskById(id) {
  const { rows } = await pool.query(
    `select t.id, t.subject, t.topic, t.ege_number, t.points, t.statement, t.hints, t.answer_type, t.bucket, t.criteria, t.min_words,
            coalesce(
              json_agg(json_build_object('storage_path', m.storage_path, 'position', m.position) order by m.position)
                filter (where m.id is not null),
              '[]'
            ) as media
     from public.tasks t
     left join public.task_media m on m.task_id = t.id
     where t.id = $1
     group by t.id`,
    [id]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    subject: row.subject,
    egeNumber: row.ege_number ?? 0,
    topic: row.topic,
    points: row.points,
    statement: row.statement.split(/\n+/).filter(Boolean),
    hints: row.hints?.length === 3 ? row.hints : [row.hints?.[0] ?? "", row.hints?.[1] ?? "", row.hints?.[2] ?? ""],
    answerType: row.bucket === "essay" ? "essay" : "short",
    criteria: row.criteria ?? undefined,
    minWords: row.min_words ?? undefined,
    media: row.media ?? [],
  };
}

app.post("/ai-tutor", authMiddleware, async (req, res) => {
  const [settings, policy] = await Promise.all([resolveAiSettings(), resolveSystemPrompt()]);
  if (!settings.apiKey) return res.status(500).json({ error: "Ключ ИИ-провайдера не настроен — задай его в /admin → «ИИ-репетитор»" });
  const userId = req.user.sub;
  const body = req.body ?? {};
  try {
    const task = body.taskId ? safeTaskById(body.taskId) ?? (await dbSafeTaskById(body.taskId)) : undefined;
    const gate = await resolveUserTariffGate(userId);

    if (body.mode === "check_essay") {
      if (!task) return res.status(404).json({ error: "task not found" });
      if (!gate.isAdmin && gate.priceRub <= 0) {
        // как и лимит ниже — 200 с готовым текстом, а не ошибка, чтобы клиент не ушёл в офлайн-
        // фолбэк молча и не выдал вместо этого шаблонную заглушку "оценки". assessment не шлём —
        // EssayView.tsx/MockExam.tsx это уже умеют трактовать как "оценки нет".
        return res.json({
          text: "Проверка сочинений и развёрнутых ответов по критериям доступна на платных тарифах — открой любой из них на странице «Тарифы».",
          tierBlocked: true,
        });
      }
      const assessment = await callClaudeEssayAssessor(settings, policy, task, body.essayText ?? "");
      pool
        .query(
          `insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,$3,'user',$4), ($1,$2,$3,'assistant',$5)`,
          [userId, body.taskId, body.mode, body.essayText ?? "", JSON.stringify(assessment)]
        )
        .catch((e) => console.warn("audit log failed", e));
      return res.json({ assessment });
    }

    const limitCheck = await checkDailyAiLimit(gate, userId);
    if (limitCheck.limited) {
      // 200, а не 429 — это штатный, ожидаемый ответ репетитора, а не сбой: клиент (lib/aiTutor.ts)
      // при ошибке молча уходит в офлайн-фолбэк с шаблонными подсказками, что скрыло бы от ученика
      // сам факт исчерпания лимита. В ai_messages не пишем — это не настоящее обращение к модели,
      // не в счёт свежей попытки.
      return res.json({
        text: "Дневной лимит обращений к ИИ-репетитору исчерпан — приходи завтра, или открой безлимит с тарифа от 1990 ₽/мес на странице «Тарифы».",
        limitReached: true,
      });
    }

    const system =
      body.mode === "hint" ? buildHintPrompt(policy, task, body.hintLevel ?? 0) : body.mode === "explain_topic" ? buildExplainPrompt(policy, task) : buildChatPrompt(policy, task);
    const history = (body.history ?? []).slice(-8);

    // иллюстрации к заданию — в промпт (формулы текстом всегда, картинки в vision, если провайдер
    // умеет) — см. taskImages.js. Только для режимов, где реально идёт речь о конкретном задании.
    let userContent = body.message ?? "";
    if (task?.media?.length && body.mode !== "check_essay") {
      const attachments = buildTaskAttachments(task.media, supportsVision(settings));
      userContent = buildUserContent(settings.provider, userContent, attachments);
    }
    const messages = [...history, { role: "user", content: userContent }];

    let text = await callText(settings, system, messages);

    if (body.mode === "hint" && leaksAnswer(text, body.taskId)) {
      console.warn("postfilter: подозрение на утечку ответа", { taskId: body.taskId, userId });
      text = "Кажется, я чуть не сказал больше, чем должен был 🙂 Давай по-другому: какой следующий шаг ты бы сделал сам, опираясь на предыдущую подсказку?";
    }

    if (body.mode === "hint") {
      pool.query("insert into public.hints_used (user_id, task_id, level) values ($1,$2,$3)", [userId, body.taskId, (body.hintLevel ?? 0) + 1]).catch((e) => console.warn("hints log failed", e));
    }
    pool
      .query(`insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,$3,'user',$4), ($1,$2,$3,'assistant',$5)`, [
        userId,
        body.taskId ?? null,
        body.mode,
        body.message ?? "",
        text,
      ])
      .catch((e) => console.warn("audit log failed", e));

    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** Текущий остаток дневной квоты ИИ-репетитора — чтобы честно показать ограничение free-тарифа
 * ДО того, как ученик в него упрётся (см. TutorChat.tsx), а не только постфактум сообщением из
 * /ai-tutor выше. limited:false — тариф безлимитный или это админ, remaining можно не смотреть. */
app.get("/ai-tutor/quota", authMiddleware, async (req, res) => {
  try {
    const gate = await resolveUserTariffGate(req.user.sub);
    if (gate.isAdmin || gate.dailyAiLimit == null) return res.json({ limited: false });
    const used = await countTodayTutorMessages(req.user.sub);
    res.json({ limited: true, limit: gate.dailyAiLimit, used, remaining: Math.max(0, gate.dailyAiLimit - used) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
