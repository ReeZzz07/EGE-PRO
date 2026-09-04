// Публикация банка из output/neofamily/<subject>/tasks.jsonl — формат другого агрегатора
// (не сырой скрап ФИПИ): question_html/answer_html с уже готовым решением/ответом внутри
// (текстовые маркеры "Решение:"/"Ответ:" для коротких, "Элементы ключа:" для развёрнутых).
// В отличие от publish-to-supabase.mjs (LLM-solve пайплайн), здесь просто парсим готовый ответ —
// LLM не вызывается вообще.
//
// node scripts/import/publish-neofamily.mjs --admin-email=... --admin-password=...
//   [--subject=biologiya] [--limit=N] [--skip-media] [--only-media] [--concurrency=15]

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

const SUBJECT_DIR_MAP = {
  angliyskiy_yazyk: "eng",
  biologiya: "bio",
  fizika: "fiz",
  geografiya: "geo",
  himiya: "chem",
  istoriya: "hist",
  literatura: "lit",
  matematika_baza: "math_base",
  matematika_profil: "math",
  obschestvoznanie: "soc",
  russkiy_yazyk: "rus",
};

const root = path.join(process.cwd(), "output", "neofamily");
const onlySubject = args.subject;
const limit = args.limit ? Number(args.limit) : Infinity;
const skipMedia = args["skip-media"] === "true";
const onlyMedia = args["only-media"] === "true";
const concurrency = Number(args.concurrency ?? 15);

const baseUrl = args["base-url"] ?? process.env.LOCAL_BACKEND_URL ?? "http://localhost:3100";
const adminEmail = args["admin-email"] ?? process.env.ADMIN_EMAIL;
const adminPassword = args["admin-password"] ?? process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error("Нужны --admin-email/--admin-password");

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html) {
  let text = (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Двоеточие после маркера — обязательное, не "\s*:?": иначе search()/split() ловят слово
// "ответ"/"источник"/"элементы ключа" где угодно в обычном тексте пояснения (например внутри
// слова "соответствует") как будто это разметка поля, и обрубают explanation/answer не там.
// Это реально произошло при первом импорте банка — см. репарацию battle-tested regex в
// docker/api/importArchive.js (тот же баг, тот же фикс, продублировано намеренно — см. комментарий
// в начале файла) и одноразовый скрипт восстановления ~3100 испорченных ответов в БД.
/** short: "...Решение:...Ответ: X...Источник: ..." → {answer, explanation} */
function parseShortAnswer(answerHtml) {
  let text = stripHtml(answerHtml);
  text = text.split(/Источник\s*:/i)[0];
  const idx = text.search(/Ответ\s*:/i);
  if (idx === -1) return { answer: null, explanation: text.trim() || null };
  const explanation = text.slice(0, idx).replace(/^Решение\s*:/i, "").trim();
  const answerRaw = text
    .slice(idx)
    .replace(/^Ответ\s*:/i, "")
    .trim();
  return { answer: answerRaw || null, explanation: explanation || null };
}

/** full: "...Элементы ключа:\n1) ...;\n2) ... ИЛИ\n2) ...;\nИсточник: ..." → [{code,name,max}] */
function parseCriteria(answerHtml) {
  let text = stripHtml(answerHtml);
  text = text.split(/Источник\s*:/i)[0];
  const m = text.split(/Элементы ключа\s*:/i);
  const body = m.length > 1 ? m[1] : text;
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const byNum = new Map();
  const order = [];
  for (const line of lines) {
    const nm = line.match(/^(\d+)\)\s*(.+)/);
    if (!nm) continue;
    const num = nm[1];
    const content = nm[2].replace(/;$/, "");
    if (byNum.has(num)) {
      byNum.get(num).name += " ИЛИ " + content;
    } else {
      const c = { code: `К${num}`, name: content, max: 1 };
      byNum.set(num, c);
      order.push(c);
    }
  }
  return order.length ? order : null;
}

function buildHints(topic, explanation, answer) {
  const sentences = (explanation || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const redact = (s) => {
    if (!answer) return s;
    for (const alt of String(answer).split("/")) {
      const a = alt.trim();
      if (!a) continue;
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp(`(^|\\W)${esc}(\\W|$)`, "gi"), "$1…$2");
    }
    return s;
  };
  const level1 = `Тема задания: «${topic}». Внимательно перечитай условие и вспомни, какие факты по этой теме сюда относятся.`;
  if (!sentences.length) return [level1, level1, level1];
  const half = Math.max(1, Math.ceil(sentences.length * 0.4));
  const level2 = redact(sentences.slice(0, half).join(" ")) || level1;
  const level3 = redact(sentences.join(" ")) || level2;
  return [level1, level2, level3];
}

function buildEssayHints(topic, criteria) {
  const level1 = `Тема задания: «${topic}». Вспомни, что важно упомянуть по этой теме.`;
  if (!criteria || !criteria.length) return [level1, level1, level1];
  const level2 = `На что стоит опираться в ответе: ${criteria[0].name}.`;
  const level3 = `Ключевые элементы полного ответа: ${criteria.map((c) => c.name).join("; ")}.`;
  return [level1, level2, level3];
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function pool(items, worker, size) {
  let idx = 0;
  let active = 0;
  let okCount = 0,
    failCount = 0;
  return new Promise((resolve) => {
    function next() {
      if (idx >= items.length && active === 0) return resolve({ okCount, failCount });
      while (active < size && idx < items.length) {
        const item = items[idx++];
        active++;
        worker(item)
          .then(() => okCount++)
          .catch((e) => {
            failCount++;
            console.warn("  warn:", e?.message ?? e);
          })
          .finally(() => {
            active--;
            next();
          });
      }
    }
    next();
  });
}

function contentTypeFor(ext) {
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Источник не даёт реальной сложности задания — только номер в структуре ЕГЭ (task_line.name).
 *  Задания в ЕГЭ идут примерно по возрастанию сложности, поэтому делим номера предмета на трети
 *  (терцили): первая треть — база, средняя — повышенная, последняя — высокая. Развёрнутые ответы
 *  (сочинения/эссе) — всегда высокая сложность, независимо от номера. confidenceToDifficulty()
 *  на фронтенде уже понимает high/null/low именно так — здесь просто заполняем значение вместо
 *  прежнего жёстко захардкоженного null (из-за которого вся база показывала одну сложность).
 */
function assignDifficulty(taskRows) {
  const nums = [...new Set(taskRows.filter((r) => r.bucket !== "essay" && r.ege_number != null).map((r) => r.ege_number))].sort((a, b) => a - b);
  const tertileOf = new Map();
  nums.forEach((n, i) => tertileOf.set(n, Math.min(2, Math.floor((i / nums.length) * 3))));
  for (const row of taskRows) {
    if (row.bucket === "essay") {
      row.confidence = "low";
    } else if (row.ege_number == null) {
      row.confidence = null;
    } else {
      const t = tertileOf.get(row.ege_number);
      row.confidence = t === 0 ? "high" : t === 1 ? null : "low";
    }
  }
}

function buildRowsForSubject(folder, dbSubject) {
  const subjDir = path.join(root, folder);
  const lines = fs
    .readFileSync(path.join(subjDir, "tasks.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);

  const taskRows = [];
  const mediaByTask = new Map();

  for (const line of lines) {
    const t = JSON.parse(line);
    const id = `${dbSubject}-${t.task_id}`;
    const theme = t.themes?.[0];
    const topic = theme?.name ?? (t.subject ?? folder);
    const section = theme?.section?.name ?? null;
    const bucket = t.answer_type === "full" ? "essay" : "auto";
    const { text: statement } = cleanTaskHtml(t.question_html ?? "", undefined);
    const points = Number.isFinite(t.task_line?.value) ? t.task_line.value : 2;
    const egeNumRaw = t.task_line?.name;
    const egeNumber = egeNumRaw != null && /^\d+$/.test(String(egeNumRaw)) ? Number(egeNumRaw) : null;

    let answer = null,
      explanation = null,
      criteria = null,
      hints;
    let needsReview = false;

    if (bucket === "auto") {
      const parsed = parseShortAnswer(t.answer_html ?? "");
      answer = parsed.answer;
      explanation = parsed.explanation;
      if (!answer) needsReview = true;
      hints = buildHints(topic, explanation, answer);
    } else {
      criteria = parseCriteria(t.answer_html ?? "");
      if (!criteria) needsReview = true;
      hints = buildEssayHints(topic, criteria);
    }

    taskRows.push({
      id,
      subject: dbSubject,
      topic,
      section,
      ege_number: egeNumber,
      answer_type: t.answer_type ?? null,
      bucket,
      points,
      statement: statement || "(пустое условие после очистки HTML)",
      options: null,
      answer,
      explanation,
      hints,
      criteria,
      min_words: null,
      confidence: null, // проставится ниже, в assignDifficulty(), по всему набору заданий предмета
      needs_review: needsReview,
      published: !needsReview,
    });

    const imgs = (t.attachments ?? []).filter((a) => a.type === "image");
    if (imgs.length) {
      const list = [];
      let pos = 0;
      for (const att of imgs) {
        const full = path.join(subjDir, att.path);
        if (!fs.existsSync(full)) continue;
        const ext = path.extname(att.path);
        const storagePath = `neofamily/${folder}/${t.task_id}_${pos}${ext}`;
        list.push({ storage_path: storagePath, position: pos, fullLocalPath: full });
        pos++;
        if (pos >= 4) break;
      }
      if (list.length) mediaByTask.set(id, list);
    }
  }

  assignDifficulty(taskRows);
  return { taskRows, mediaByTask };
}

async function main() {
  const { from, uploadFile, user } = await connectLocalBackend({ baseUrl, email: adminEmail, password: adminPassword });
  console.log(`Вошли как ${user.email}`);

  const folders = onlySubject ? [onlySubject] : Object.keys(SUBJECT_DIR_MAP);

  let grandTasks = 0,
    grandMedia = 0;

  for (const folder of folders) {
    const dbSubject = SUBJECT_DIR_MAP[folder];
    if (!dbSubject) throw new Error(`Неизвестный предмет: ${folder}`);
    console.log(`\n=== ${folder} → ${dbSubject} ===`);

    let { taskRows, mediaByTask } = buildRowsForSubject(folder, dbSubject);
    if (limit !== Infinity) {
      taskRows = taskRows.slice(0, limit);
      const keep = new Set(taskRows.map((t) => t.id));
      mediaByTask = new Map([...mediaByTask].filter(([id]) => keep.has(id)));
    }
    console.log(`Заданий: ${taskRows.length} | опубликовано сразу: ${taskRows.filter((t) => t.published).length} | на проверке: ${taskRows.filter((t) => !t.published).length}`);

    if (!onlyMedia) {
      let done = 0;
      for (const batch of chunk(taskRows, 500)) {
        const { error } = await from("tasks").upsert(batch, { onConflict: "id" });
        if (error) throw new Error(`Ошибка вставки tasks (${folder}): ${error.message}`);
        done += batch.length;
      }
      console.log(`  tasks: ${done} записано`);
      grandTasks += done;
    }

    if (!skipMedia && mediaByTask.size) {
      const allIds = [...mediaByTask.keys()];
      for (const idBatch of chunk(allIds, 300)) {
        const { error } = await from("task_media").delete().in("task_id", idBatch);
        if (error) console.warn(`  warn: очистка старых media: ${error.message}`);
      }

      const jobs = [];
      for (const [taskId, list] of mediaByTask) for (const m of list) jobs.push({ taskId, m });

      let uploaded = 0;
      const { okCount, failCount } = await pool(
        jobs,
        async ({ taskId, m }) => {
          const bytes = fs.readFileSync(m.fullLocalPath);
          await uploadFile("task-media", m.storage_path, bytes, contentTypeFor(path.extname(m.fullLocalPath)));
          uploaded++;
          if (uploaded % 200 === 0) console.log(`  media: ${uploaded}/${jobs.length}`);
        },
        concurrency
      );
      console.log(`  media загружено: ${okCount}, ошибок: ${failCount}`);

      const mediaRows = [];
      for (const [taskId, list] of mediaByTask) for (const m of list) mediaRows.push({ task_id: taskId, storage_path: m.storage_path, position: m.position });
      for (const batch of chunk(mediaRows, 500)) {
        const { error } = await from("task_media").insert(batch);
        if (error) console.warn(`  warn: вставка task_media: ${error.message}`);
      }
      grandMedia += mediaRows.length;
    }
  }

  console.log(`\nИТОГО: заданий=${grandTasks}, медиа=${grandMedia}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
