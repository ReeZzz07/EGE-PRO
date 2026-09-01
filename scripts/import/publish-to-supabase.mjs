// Заливает то, что подготовил publish-tasks.mjs (JSON-манифест + пересобранные данные),
// напрямую в Supabase через supabase-js — без прогонки гигантского SQL через диалог с ассистентом.
// Авторизуется под админом (RLS admin-write политика для public.tasks/task_media/storage.objects).
//
// node scripts/import/publish-to-supabase.mjs --subject=biologiya --db-subject=bio
//   --admin-email=... --admin-password=...   (или переменные окружения ADMIN_EMAIL/ADMIN_PASSWORD)

import fs from "node:fs";
import path from "node:path";
import { connectLocalBackend } from "./lib/local-backend.mjs";
import { cleanTaskHtml } from "./lib/clean-html.mjs";

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(process.cwd(), ".env"));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const subjectDir = args.subject ?? "biologiya";
const dbSubject = args["db-subject"] ?? "bio";
const adminEmail = args["admin-email"] ?? process.env.ADMIN_EMAIL;
const adminPassword = args["admin-password"] ?? process.env.ADMIN_PASSWORD;
const skipMedia = args["skip-media"] === "true";
const onlyMedia = args["only-media"] === "true";

const baseUrl = args["base-url"] ?? process.env.LOCAL_BACKEND_URL ?? "http://localhost:3100";
if (!adminEmail || !adminPassword) throw new Error("Нужны --admin-email/--admin-password (или ADMIN_EMAIL/ADMIN_PASSWORD)");

const root = path.join(process.cwd(), "output", subjectDir);

const SECTION_LABELS = {
  1: "Биология как наука. Методы научного познания",
  2: "Клетка как биологическая система",
  3: "Организм как биологическая система",
  4: "Многообразие организмов",
  5: "Человек и его здоровье",
  6: "Эволюция и надорганизменные системы",
  7: "Экосистемы и присущие им закономерности",
};

function topicLabel(topics) {
  const first = Array.isArray(topics) && topics.length ? topics[0] : null;
  if (!first) return "Биология";
  const section = Number(String(first).split(".")[0]);
  return SECTION_LABELS[section] ?? "Биология";
}

function buildHints(topic, explanation, answer) {
  const sentences = (explanation || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const redact = (s) => {
    if (!answer) return s;
    const esc = String(answer).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return s.replace(new RegExp(`(^|\\W)${esc}(\\W|$)`, "gi"), "$1…$2");
  };
  const level1 = `Тема задания: «${topic}». Внимательно перечитай условие и вспомни, какие факты по этой теме сюда относятся.`;
  const half = Math.max(1, Math.ceil(sentences.length * 0.4));
  const level2 = redact(sentences.slice(0, half).join(" ")) || level1;
  const level3 = redact(sentences.join(" ")) || level2;
  return [level1, level2, level3];
}

function buildRows() {
  const source = fs
    .readFileSync(path.join(root, "tasks.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const sourceById = new Map(source.map((t) => [t.task_id, t]));

  const answeredById = new Map();
  for (const line of fs.readFileSync(path.join(root, "tasks.answered.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    answeredById.set(r.task_id, r);
  }

  const taskRows = [];
  const mediaByTask = new Map(); // task_id -> [{storage_path, position, fullLocalPath}]

  for (const [taskId, result] of answeredById) {
    if (result.status !== "solved") continue;
    const task = sourceById.get(taskId);
    if (!task) continue;

    const { text, imagesInOrder } = cleanTaskHtml(task.body_html, task.variants);
    const statement = text || "(пустое условие после очистки HTML)";
    const topic = topicLabel(task.topics);
    const bucket = result.bucket ?? (task.answer_type === "full" || task.answer_type === "Развернутый альтернативный" ? "essay" : "auto");
    const points = bucket === "essay" ? 3 : 2;
    const needsReview = !!result.needs_review;

    const hints =
      bucket === "essay"
        ? buildHints(topic, (result.notes ?? "") + " " + JSON.stringify(result.criteria ?? []), null)
        : buildHints(topic, result.explanation ?? "", result.answer ?? null);

    taskRows.push({
      id: taskId,
      subject: dbSubject,
      topic,
      ege_number: null,
      answer_type: task.answer_type ?? null,
      bucket,
      points,
      statement,
      options: null,
      answer: bucket === "auto" ? result.answer ?? null : null,
      explanation: bucket === "auto" ? result.explanation ?? null : null,
      hints,
      criteria: bucket === "essay" ? result.criteria ?? null : null,
      min_words: bucket === "essay" ? toIntOrNull(result.minWords) : null,
      confidence: result.confidence ?? null,
      needs_review: needsReview,
      published: !needsReview,
    });

    let pos = 0;
    const list = [];
    for (const src of imagesInOrder) {
      const rel = src.replace(/^\/+/, "");
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) continue;
      const ext = path.extname(rel);
      const storagePath = `${subjectDir}/${taskId}_${pos}${ext}`;
      list.push({ storage_path: storagePath, position: pos, fullLocalPath: full });
      pos++;
      if (pos >= 4) break;
    }
    if (list.length) mediaByTask.set(taskId, list);
  }

  return { taskRows, mediaByTask };
}

function toIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function contentTypeFor(ext) {
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }[ext.toLowerCase()] ?? "application/octet-stream";
}

async function main() {
  const { from, uploadFile, user } = await connectLocalBackend({ baseUrl, email: adminEmail, password: adminPassword });
  console.log(`Вошли как ${user.email} (id ${user.id})`);

  let { taskRows, mediaByTask } = buildRows();
  if (args.limit) {
    taskRows = taskRows.slice(0, Number(args.limit));
    const keep = new Set(taskRows.map((t) => t.id));
    mediaByTask = new Map([...mediaByTask].filter(([id]) => keep.has(id)));
  }
  console.log(`Заданий к публикации: ${taskRows.length}`);
  console.log(`Опубликовано сразу: ${taskRows.filter((t) => t.published).length} | на проверке: ${taskRows.filter((t) => !t.published).length}`);

  if (!onlyMedia) {
    const batches = chunk(taskRows, 200);
    let done = 0;
    for (const batch of batches) {
      const { error } = await from("tasks").upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`Ошибка вставки tasks (батч из ${batch.length}): ${error.message}`);
      done += batch.length;
      console.log(`  tasks: ${done}/${taskRows.length}`);
    }
  }

  if (!skipMedia) {
    // сначала чистим старые media-записи для этих task_id (идемпотентность при повторном запуске)
    const allIds = [...mediaByTask.keys()];
    for (const idBatch of chunk(allIds, 200)) {
      const { error } = await from("task_media").delete().in("task_id", idBatch);
      if (error) console.warn(`  warn: не удалось очистить старые media для батча: ${error.message}`);
    }

    let uploaded = 0,
      failed = 0;
    const mediaRows = [];
    for (const [taskId, list] of mediaByTask) {
      for (const m of list) {
        const bytes = fs.readFileSync(m.fullLocalPath);
        try {
          await uploadFile("task-media", m.storage_path, bytes, contentTypeFor(path.extname(m.fullLocalPath)));
        } catch (upErr) {
          console.warn(`  warn: не загрузилась картинка ${m.storage_path}: ${upErr.message}`);
          failed++;
          continue;
        }
        mediaRows.push({ task_id: taskId, storage_path: m.storage_path, position: m.position });
        uploaded++;
        if (uploaded % 50 === 0) console.log(`  media: загружено ${uploaded}`);
      }
    }
    console.log(`Изображений загружено: ${uploaded}, ошибок: ${failed}`);

    for (const batch of chunk(mediaRows, 300)) {
      const { error } = await from("task_media").insert(batch);
      if (error) throw new Error(`Ошибка вставки task_media: ${error.message}`);
    }
    console.log(`Записей task_media: ${mediaRows.length}`);
  }

  console.log("Готово.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
