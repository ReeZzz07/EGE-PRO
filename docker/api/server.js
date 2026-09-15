// Заменяет три вещи из облачного Supabase: Auth (GoTrue), Storage API и Edge Function ai-tutor.
// REST (.from()) не портируется сюда — за это отвечает отдельный контейнер postgrest (вызывает
// PostgREST напрямую, он wire-совместим с supabase-js .from()).
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";
import { safeTaskById, TASK_ANSWERS } from "./safeTasks.js";
import { buildChatPrompt, buildEssaySystemPrompt, buildExplainPrompt, buildHintPrompt, DEFAULT_POLICY } from "./prompt.js";
import { callText, callTool } from "./providers.js";
import { parseImportArchive, readZipFile } from "./importArchive.js";
import { buildTaskAttachments, buildUserContent, supportsVision } from "./taskImages.js";
import {
  resolveUserTariffGate,
  countTodayTutorMessages,
  reserveDailyAiSlot,
  releaseDailyAiSlot,
  isEssayCheckAllowed,
  reserveEssayCheckSlot,
  releaseEssayCheckSlot,
} from "./tariffGate.js";
import { searchUsers, getUserDetail, getUserEmail, updateUser, exportUserData, anonymizeUser, deleteUserCascade, logAdminAction } from "./adminUsers.js";

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET;
// .env — запасной вариант на случай, если админ ещё не сохранил настройку в БД (app_settings,
// вкладка "ИИ-репетитор" в /admin) — см. resolveAiSettings() ниже.
const ENV_FALLBACK_SETTINGS = { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY || "", model: process.env.ANTHROPIC_MODEL || "", baseUrl: "" };
const STORAGE_ROOT = process.env.STORAGE_ROOT || "/data/storage";
if (!JWT_SECRET) throw new Error("JWT_SECRET не задан");

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const app = express();
// Единственный путь, которым браузер сюда попадает — через dev-proxy внутри контейнера web (см.
// vite.config.js, xfwd:true), поэтому доверяем РОВНО одному хопу: express-rate-limit/req.ip будут
// брать реальный IP браузера из X-Forwarded-For, который добавляет этот хоп, а не значение, которое
// клиент мог бы подсунуть сам тем же заголовком (при trust proxy:1 всё, что левее одного доверенного
// хопа, игнорируется — см. документацию express на "trust proxy"). Без этой строки все запросы
// приходили бы с одним и тем же req.ip (адресом контейнера web) и делили один общий лимит на всех.
app.set("trust proxy", 1);
// helmet трогаем осторожно: contentSecurityPolicy/crossOriginEmbedderPolicy по умолчанию рассчитаны
// на то, что этот же сервис отдаёт HTML — здесь только JSON API + статика из /storage (картинки,
// отдаются на чужой origin, см. GET /storage/:bucket/* ниже), включённый CSP/COEP по умолчанию их
// не ломает, но crossOriginResourcePolicy обязательно "cross-origin", иначе браузер блокирует
// картинки задания, запрошенные с origin фронтенда (localhost:3100) у этого сервиса (localhost:8787).
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
// раньше cors() без опций разрешал ЛЮБОЙ origin с любыми учётными данными — для API, куда
// авторизованные запросы идут с Bearer-токеном (не куки), это не даёт CSRF, но всё равно позволяет
// произвольному сайту читать ответы (например, чужой JS мог бы дёргать /ai-tutor с украденным из
// localStorage токеном). CORS_ORIGIN — через запятую список разрешённых origin (см. docker-compose.yml).
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3100").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// авторизация/регистрация и ИИ-репетитор — самые дорогие/чувствительные к брутфорсу и накрутке
// счётчиков эндпоинты; остальные (storage, admin-импорт) либо требуют admin, либо не так опасны.
// 100/15мин на IP — заметно выше того, что нужно живому ученику (даже с опечатками в пароле), но
// не настолько высоко, чтобы не тормозить подбор пароля (тем более что каждая проверка — это ещё
// и bcrypt.compare с cost 10, ~50-100мс сам по себе); нижняя граница — реальный backend test suite
// (docker/api/test/*.test.js), который гоняет через эти же роуты десятки запросов за секунды.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const aiTutorLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

function signToken(user, tokenVersion) {
  // 7 дней, а не 30 — токен всё равно можно отозвать раньше (см. token_version ниже), но короче
  // срок жизни сам по себе сокращает окно, в которое ворованный токен остаётся полезен, даже если
  // до отзыва (смены пароля) никто не додумался.
  return jwt.sign({ sub: user.id, role: "authenticated", email: user.email, tv: tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: "7d" });
}

/** Токен подписан верно и не просрочен — но это не значит, что он ещё действителен: смена пароля
 *  (см. POST /auth/change-password) бампает token_version в БД, и все токены с более старым tv
 *  сразу должны отваливаться, даже если им ещё есть 6 дней жизни (см. миграцию 0022). */
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "missing authorization" });
  let payload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
  try {
    const { rows } = await pool.query("select token_version from public.profiles where id = $1", [payload.sub]);
    // профиля может не быть (аккаунт только что создан до вставки профиля, или гостевой auth.users
    // без строки в profiles) — тогда сверять не с чем, пропускаем как раньше, до появления tv.
    if (rows[0] && (payload.tv ?? 0) < rows[0].token_version) return res.status(401).json({ error: "token revoked" });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
  req.user = payload;
  next();
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

app.post("/auth/signup", authLimiter, async (req, res) => {
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
    // свежий аккаунт — token_version всегда 0 (см. миграцию 0022, default), профиль ещё создаётся
    // триггером handle_new_user асинхронно с этим же insert, читать его здесь незачем.
    res.json({ data: { user }, error: null, access_token: signToken(user, 0) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

app.post("/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  try {
    const { rows } = await pool.query(
      `select u.id, u.email, u.encrypted_password, coalesce(p.token_version, 0) as token_version
       from auth.users u left join public.profiles p on p.id = u.id where u.email = $1`,
      [email]
    );
    const row = rows[0];
    if (!row || !(await bcrypt.compare(password ?? "", row.encrypted_password))) {
      return res.status(400).json({ error: { message: "Неверный email или пароль" } });
    }
    res.json({ data: { user: { id: row.id, email: row.email } }, error: null, access_token: signToken(row, row.token_version) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

// удаление аккаунта необратимо, поэтому подтверждаем паролем (не полагаемся на один лишь факт
// владения токеном — вкладка могла остаться открытой на чужом устройстве). Все пользовательские
// таблицы ссылаются на auth.users с "on delete cascade" (см. миграции), так что удаление одной
// строки уносит профиль, предметы, попытки, диагностику, план, чат с ИИ — но НЕ файл аватарки
// (см. POST /profile/avatar ниже, он живёт на диске, а не в БД), его чистим отдельно сами.
app.delete("/auth/account", authMiddleware, async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: { message: "Введи пароль, чтобы подтвердить удаление" } });
  try {
    const { rows } = await pool.query("select encrypted_password from auth.users where id = $1", [req.user.sub]);
    const row = rows[0];
    if (!row || !(await bcrypt.compare(password, row.encrypted_password))) {
      return res.status(400).json({ error: { message: "Неверный пароль" } });
    }
    removeExistingAvatarFiles(req.user.sub);
    await pool.query("delete from auth.users where id = $1", [req.user.sub]);
    res.json({ error: null });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

// смена пароля — тоже подтверждаем текущим паролем (та же логика, что и удаление аккаунта выше:
// не полагаемся на один факт владения токеном).
app.post("/auth/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: { message: "Новый пароль должен быть не короче 6 символов" } });
  try {
    const { rows } = await pool.query("select encrypted_password from auth.users where id = $1", [req.user.sub]);
    const row = rows[0];
    if (!row || !(await bcrypt.compare(currentPassword ?? "", row.encrypted_password))) {
      return res.status(400).json({ error: { message: "Неверный текущий пароль" } });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("update auth.users set encrypted_password = $2 where id = $1", [req.user.sub, hash]);
    // бампаем token_version сразу после — все токены, выпущенные до смены пароля (в т.ч.
    // потенциально украденные), сразу перестают проходить authMiddleware (см. миграцию 0022).
    const upd = await pool.query("update public.profiles set token_version = token_version + 1 where id = $1 returning token_version", [req.user.sub]);
    const nextTv = upd.rows[0]?.token_version ?? (req.user.tv ?? 0) + 1;
    // свежий токен — иначе собственная, только что успешно завершившая смену пароля сессия
    // моментально сама себя разлогинивала бы этим же бампом (см. комментарий у change-email ниже,
    // та же необходимость).
    res.json({ data: { user: { id: req.user.sub, email: req.user.email } }, error: null, access_token: signToken({ id: req.user.sub, email: req.user.email }, nextTv) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

// смена email — тоже требует пароль. Возвращаем свежий токен (в нём зашит email, см. signToken),
// иначе клиент до следующего входа продолжал бы слать токен со старым email в payload.
app.post("/auth/change-email", authMiddleware, async (req, res) => {
  const { password, newEmail } = req.body ?? {};
  if (!newEmail) return res.status(400).json({ error: { message: "Введи новый email" } });
  try {
    const { rows } = await pool.query("select email, encrypted_password from auth.users where id = $1", [req.user.sub]);
    const row = rows[0];
    if (!row || !(await bcrypt.compare(password ?? "", row.encrypted_password))) {
      return res.status(400).json({ error: { message: "Неверный пароль" } });
    }
    // tv переносим как есть (req.user.tv уже прошёл проверку в authMiddleware) — иначе новый
    // токен подписался бы с tv:0 по умолчанию и сам себя тут же считал бы отозванным, если
    // token_version в БД уже был поднят раньше (см. change-password выше).
    if (newEmail === row.email) return res.json({ data: { user: { id: req.user.sub, email: row.email } }, error: null, access_token: signToken({ id: req.user.sub, email: row.email }, req.user.tv) });
    const existing = await pool.query("select id from auth.users where email = $1", [newEmail]);
    if (existing.rows.length) return res.status(400).json({ error: { message: "Этот email уже занят другим аккаунтом" } });
    await pool.query("update auth.users set email = $2 where id = $1", [req.user.sub, newEmail]);
    const user = { id: req.user.sub, email: newEmail };
    res.json({ data: { user }, error: null, access_token: signToken(user, req.user.tv) });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message ?? e) } });
  }
});

// ─────────────────────── storage ───────────────────────

// 15 МБ хватало для картинок/аватарок, но записи для заданий на аудирование (task-media, см.
// scripts/import/publish-neofamily.mjs) доходят до ~29 МБ — 40 МБ оставляет запас без открытия
// лимита слишком широко (это всё ещё контентная загрузка только для admin, см. requireAdmin ниже).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// Единственные два реальных бакета (см. avatar.ts/adminTasks.ts на фронтенде) — раньше bucket
// приходил из URL/тела запроса без проверки вообще, и только относительный путь p проверялся на
// "..". Строка вида "..%2F..%2Fetc" в :bucket из GET /storage/:bucket/* (единственный публичный,
// без authMiddleware — картинки должны открываться без входа) декодируется Express'ом в "../../etc"
// ДО того, как попадает в path.join(STORAGE_ROOT, bucket, rel) — обходя проверку p и читая
// произвольный файл с диска контейнера. Разрешаем только эти два конкретных имени.
const KNOWN_BUCKETS = new Set(["avatars", "task-media"]);

function safeRelPath(bucket, p) {
  if (!KNOWN_BUCKETS.has(bucket)) throw new Error("неизвестный bucket");
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

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  // аудио к заданиям на аудирование (см. task_media/EgeTask.images в SolveView/EssayView) — без
  // верного content-type браузер не обязан проигрывать <audio src> корректно.
  ".mp3": "audio/mpeg",
};

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

// ─────────────────────── аватар профиля ───────────────────────
// Отдельный от /storage/upload путь: тот требует requireAdmin (доверенная загрузка контента
// заданий), а сюда может постучаться любой авторизованный ученик. Раз аудитория шире — путь
// вычисляем сами по req.user.sub, а не берём из тела запроса (иначе можно было бы перезаписать
// чужой файл), и проверяем содержимое по магическим байтам, а не расширению из имени файла.
const AVATAR_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };

function sniffAvatarImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  const ascii6 = buf.toString("ascii", 0, Math.min(6, buf.length));
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function removeExistingAvatarFiles(userId) {
  for (const ext of Object.values(AVATAR_EXT)) {
    const full = safeRelPath("avatars", `${userId}${ext}`);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

app.post("/profile/avatar", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: "Файл не получен" } });
    const mime = sniffAvatarImageType(req.file.buffer);
    const ext = AVATAR_EXT[mime];
    if (!ext) return res.status(400).json({ error: { message: "Поддерживаются только PNG, JPEG, GIF и WEBP" } });

    removeExistingAvatarFiles(req.user.sub);
    const relPath = `${req.user.sub}${ext}`;
    const full = safeRelPath("avatars", relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, req.file.buffer);

    await pool.query("update public.profiles set avatar_url = $2 where id = $1", [req.user.sub, `avatars/${relPath}`]);
    res.json({ path: `avatars/${relPath}`, error: null });
  } catch (e) {
    res.status(400).json({ error: { message: String(e?.message ?? e) } });
  }
});

app.delete("/profile/avatar", authMiddleware, async (req, res) => {
  try {
    removeExistingAvatarFiles(req.user.sub);
    await pool.query("update public.profiles set avatar_url = null where id = $1", [req.user.sub]);
    res.json({ error: null });
  } catch (e) {
    res.status(400).json({ error: { message: String(e?.message ?? e) } });
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

// ─────────────────────── админка: пользователи ───────────────────────
// Просмотр/поиск/правка + действия, которые требует 152-ФЗ по запросу субъекта персональных
// данных: полная выгрузка, анонимизация, удаление. См. docker/api/adminUsers.js и миграцию
// 0023_admin_user_management.sql (журнал admin_user_actions — кто/когда обращался к чьим данным).

app.get("/admin/users", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(0, Number(req.query.page) || 0);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const q = req.query.q ? String(req.query.q).trim() : "";
    res.json(await searchUsers({ q: q || undefined, page, pageSize }));
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get("/admin/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const detail = await getUserDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Пользователь не найден" });
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// правка (в т.ч. персональная скидка, тариф и срок его действия) — любое подмножество полей,
// см. updateUser() в adminUsers.js. isAdmin запрещаем менять на своём же аккаунте здесь — иначе
// админ мог бы случайно (например, лишним кликом при массовой правке) сам себя разжаловать без
// возможности отменить действие тем же аккаунтом.
app.patch("/admin/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  const patch = req.body ?? {};
  if (patch.isAdmin !== undefined && targetId === req.user.sub) {
    return res.status(400).json({ error: "Нельзя менять права администратора на собственном аккаунте здесь" });
  }
  try {
    const result = await updateUser(targetId, patch);
    if (result.error) return res.status(400).json({ error: result.error });
    const email = await getUserEmail(targetId);
    await logAdminAction(req.user.sub, targetId, email ?? "", "edit", patch);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// полная выгрузка персональных данных — ответ на запрос субъекта данных о доступе к своим
// данным. Отдаём как файл на скачивание, не просто JSON-ответ — это то, что админ буквально
// пересылает пользователю или прикладывает к письменному ответу на его запрос.
app.get("/admin/users/:id/export", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const data = await exportUserData(req.params.id);
    if (!data) return res.status(404).json({ error: "Пользователь не найден" });
    await logAdminAction(req.user.sub, req.params.id, data.account.email, "view_export", {});
    res.setHeader("content-disposition", `attachment; filename="user-${req.params.id}-export.json"`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post("/admin/users/:id/anonymize", authMiddleware, requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.sub) return res.status(400).json({ error: "Нельзя анонимизировать собственный аккаунт" });
  try {
    const email = await getUserEmail(targetId);
    if (!email) return res.status(404).json({ error: "Пользователь не найден" });
    const result = await anonymizeUser(targetId);
    if (result.error) return res.status(400).json({ error: result.error });
    removeExistingAvatarFiles(targetId);
    await logAdminAction(req.user.sub, targetId, email, "anonymize", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.delete("/admin/users/:id", authMiddleware, requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.sub) return res.status(400).json({ error: "Нельзя удалить собственный аккаунт здесь — используй личный кабинет" });
  try {
    const email = await getUserEmail(targetId);
    if (!email) return res.status(404).json({ error: "Пользователь не найден" });
    removeExistingAvatarFiles(targetId);
    await deleteUserCascade(targetId);
    await logAdminAction(req.user.sub, targetId, email, "delete", {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
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

  // Монолог/диалог по фото, письмо по графику (устная и письменная часть ЕГЭ по английскому) —
  // раньше сюда уходил только текст ответа, без самого изображения, хотя задание прямо просит
  // описать/сравнить то, что на нём. ИИ оценивал пересказ картинки, которую сам не видел — не
  // мог заметить ни расхождение с фото, ни то, что ученик описал не то, что там есть на самом деле.
  let userContent = userMsg;
  if (task.media?.length) {
    const attachments = buildTaskAttachments(task.media, supportsVision(settings));
    userContent = buildUserContent(settings.provider, userMsg, attachments);
  }

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

  const input = await callTool(settings, buildEssaySystemPrompt(policy), userContent, tool, 1500);
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

app.post("/ai-tutor", authMiddleware, aiTutorLimiter, async (req, res) => {
  const [settings, policy] = await Promise.all([resolveAiSettings(), resolveSystemPrompt()]);
  if (!settings.apiKey) return res.status(500).json({ error: "Ключ ИИ-провайдера не настроен — задай его в /admin → «ИИ-репетитор»" });
  const userId = req.user.sub;
  const body = req.body ?? {};
  try {
    const task = body.taskId ? safeTaskById(body.taskId) ?? (await dbSafeTaskById(body.taskId)) : undefined;
    const gate = await resolveUserTariffGate(userId);

    if (body.mode === "check_essay") {
      if (!task) return res.status(404).json({ error: "task not found" });
      if (!isEssayCheckAllowed(gate)) {
        // как и лимит ниже — 200 с готовым текстом, а не ошибка, чтобы клиент не ушёл в офлайн-
        // фолбэк молча и не выдал вместо этого шаблонную заглушку "оценки". assessment не шлём —
        // EssayView.tsx/MockExam.tsx это уже умеют трактовать как "оценки нет".
        return res.json({
          text: "Проверка сочинений и развёрнутых ответов по критериям доступна на платных тарифах — открой любой из них на странице «Тарифы».",
          tierBlocked: true,
        });
      }
      // isEssayCheckAllowed выше — это доступ (платный тариф да/нет), а не числовой лимит; сам по
      // себе он не защищает от накрутки — см. reserveEssayCheckSlot в tariffGate.js. Резервируем
      // строку СРАЗУ (до обращения к модели), тем же паттерном, что и у hint/chat ниже.
      const essayLimitCheck = await reserveEssayCheckSlot(gate, userId, { taskId: body.taskId, content: body.essayText ?? "" });
      if (essayLimitCheck.limited) {
        return res.json({
          text: "Дневной лимит проверок сочинений и развёрнутых ответов исчерпан — приходи завтра.",
          limitReached: true,
        });
      }
      let assessment;
      try {
        assessment = await callClaudeEssayAssessor(settings, policy, task, body.essayText ?? "");
      } catch (e) {
        // как и у hint/chat — неудачный вызов модели не должен стоить ученику одной из его
        // (щедрых, но конечных) проверок на день.
        await releaseEssayCheckSlot(essayLimitCheck.reservationId);
        throw e;
      }
      // user-строка уже записана в reserveEssayCheckSlot выше — здесь дописываем только ответ.
      pool
        .query(`insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,'check_essay','assistant',$3)`, [userId, body.taskId, JSON.stringify(assessment)])
        .catch((e) => console.warn("audit log failed", e));
      return res.json({ assessment });
    }

    // Резервирует строку user-сообщения СРАЗУ (до обращения к модели) атомарно с самой проверкой —
    // см. reserveDailyAiSlot: раньше проверка и запись были разнесены по разные стороны медленного
    // вызова модели и ничем не сериализовались, позволяя параллельным запросам одного пользователя
    // пройти лимит разом.
    const limitCheck = await reserveDailyAiSlot(gate, userId, { taskId: body.taskId, mode: body.mode, content: body.message ?? "" });
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

    let text;
    try {
      text = await callText(settings, system, messages);
    } catch (e) {
      // Слот уже списан в reserveDailyAiSlot выше (до вызова модели — это и чинит гонку, см.
      // комментарий там), но если сама модель не ответила (сеть, таймаут, ошибка провайдера),
      // возвращать ученику ошибку И тратить его дневной лимит на попытку без ответа нечестно —
      // откатываем резервацию перед тем, как отдать 500 ниже.
      await releaseDailyAiSlot(limitCheck.reservationId);
      throw e;
    }

    if (body.mode === "hint" && leaksAnswer(text, body.taskId)) {
      console.warn("postfilter: подозрение на утечку ответа", { taskId: body.taskId, userId });
      text = "Кажется, я чуть не сказал больше, чем должен был 🙂 Давай по-другому: какой следующий шаг ты бы сделал сам, опираясь на предыдущую подсказку?";
    }

    if (body.mode === "hint") {
      pool.query("insert into public.hints_used (user_id, task_id, level) values ($1,$2,$3)", [userId, body.taskId, (body.hintLevel ?? 0) + 1]).catch((e) => console.warn("hints log failed", e));
    }
    // user-строка уже записана в reserveDailyAiSlot выше (до вызова модели, ради атомарности с
    // проверкой лимита) — здесь дописываем только ответ ассистента.
    pool
      .query(`insert into public.ai_messages (user_id, task_id, mode, role, content) values ($1,$2,$3,'assistant',$4)`, [userId, body.taskId ?? null, body.mode, text])
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

const server = app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));

// раньше необработанное исключение/rejection (например, в неawait'нутом .catch() пула — см.
// множество pool.query(...).catch(console.warn) выше, но не все асинхронные пути покрыты) просто
// падало в stderr, а процесс продолжал жить в неопределённом состоянии — Docker не перезапускал
// контейнер, потому что процесс формально не завершился. Логируем и падаем осознанно — restart:
// unless-stopped (см. docker-compose.yml) поднимет контейнер заново с чистым состоянием.
function crashAndExit(kind, err) {
  console.error(`[api] ${kind}:`, err);
  process.exit(1);
}
process.on("uncaughtException", (err) => crashAndExit("uncaughtException", err));
process.on("unhandledRejection", (err) => crashAndExit("unhandledRejection", err));

// SIGTERM — то, что шлёт `docker stop`/`docker compose down` перед SIGKILL по таймауту. Без
// обработчика Node просто убивался посреди активных запросов и открытых соединений к Postgres;
// закрываем HTTP-сервер (даём начатым ответам договорить) и пул подключений по порядку.
async function shutdown() {
  console.log("[api] SIGTERM — завершаемся...");
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
