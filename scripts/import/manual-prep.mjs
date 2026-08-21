#!/usr/bin/env node
// Готовит батч заданий для РУЧНОГО решения (без вызова какого-либо LLM API) — печатает
// JSON-массив с уже очищенным текстом, который Claude (в чате) читает и решает сама/сам,
// а результат пишет через manual-submit.mjs. Заодно механически закрывает задания, которые
// решать не нужно (нет вариантов в источнике / неподдерживаемое вложение) — как processTask
// делает в solve-tasks.mjs, чтобы формат tasks.answered.jsonl не разъезжался.
//
// Записи со status:"error" (от прежних неудачных прогонов Qwen) считаются НЕ решёнными —
// будут перерешены и заменены (старая error-строка остаётся, но task_id пересчитывается заново
// при следующем append — дублирующиеся строки по task_id безвредны, кто читает jsonl, берёт
// последнее вхождение через loadDone()/review.mjs, которые используют Set/Map).
//
// Использование:
//   node scripts/import/manual-prep.mjs --subject=biologiya --limit=20
//   node scripts/import/manual-prep.mjs --subject=biologiya --limit=20 --bucket=essay
//   node scripts/import/manual-prep.mjs --subject=biologiya --limit=20 --with-images   (включить задания с картинками)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTaskHtml, OPTION_DEPENDENT_TYPES } from "./lib/clean-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(ROOT, "output");

const AUTO_TYPES = new Set([
  "short",
  "matching",
  "Последовательность",
  "Расстановка терминов",
  "Выбор ответов из предложенных вариантов",
  "select_one",
  "Распределение",
]);
const ESSAY_TYPES = new Set(["full", "Развернутый альтернативный"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const ANSWER_TYPE_HINTS = {
  short: "Тип ответа: краткий (число, слово или словосочетание). В поле answer — только это значение, как его нужно вписать в бланк.",
  matching: "Тип ответа: установление соответствия. В поле answer — цифры без пробелов и разделителей, по порядку букв (пример: 1324).",
  "Последовательность": "Тип ответа: последовательность. В поле answer — цифры в правильном порядке без пробелов.",
  "Расстановка терминов": "Тип ответа: расстановка терминов по порядку. В поле answer — цифры/буквы в правильном порядке без пробелов.",
  "Выбор ответов из предложенных вариантов": "Тип ответа: выбор одного или нескольких вариантов. В поле answer — цифры выбранных вариантов без пробелов, по возрастанию.",
  select_one: "Тип ответа: выбор одного варианта. В поле answer — цифра выбранного варианта.",
  "Распределение": "Тип ответа: распределение по группам. В поле answer — цифры без пробелов в требуемом порядке.",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { subject: null, limit: 20, bucket: "auto", withImages: args.includes("--with-images") };
  for (const a of args) {
    if (a.startsWith("--subject=")) opts.subject = a.slice("--subject=".length);
    if (a.startsWith("--limit=")) opts.limit = Number(a.slice("--limit=".length));
    if (a.startsWith("--bucket=")) opts.bucket = a.slice("--bucket=".length);
  }
  if (!opts.subject) {
    console.error("Нужен --subject=<имя_папки_в_output>");
    process.exit(1);
  }
  return opts;
}

function loadTasks(subject) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.jsonl");
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function loadDoneStatus(subject) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      map.set(rec.task_id, rec.status); // последняя строка по task_id побеждает
    } catch {
      /* повреждённая строка — игнорируем */
    }
  }
  return map;
}

function appendResult(subject, record) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  fs.appendFileSync(p, JSON.stringify(record) + "\n");
}

function hasUnsupportedAttachment(task) {
  return (task.attachments ?? []).some((att) => {
    if (att.type !== "image") return true;
    return !IMAGE_EXT.has(path.extname(att.path).toLowerCase());
  });
}

function hasImageAttachment(task) {
  return (task.attachments ?? []).some((att) => att.type === "image" && IMAGE_EXT.has(path.extname(att.path).toLowerCase()));
}

function main() {
  const opts = parseArgs();
  const all = loadTasks(opts.subject);
  const doneStatus = loadDoneStatus(opts.subject);

  const pending = all.filter((t) => {
    const st = doneStatus.get(t.task_id);
    return st === undefined || st === "error";
  });

  const batch = [];
  let autoSkipped = 0;

  for (const task of pending) {
    if (batch.length >= opts.limit) break;

    const { text, hasOptions } = cleanTaskHtml(task.body_html, task.variants);
    const cleanedText = text || "(пустое условие после очистки HTML)";

    if (OPTION_DEPENDENT_TYPES.has(task.answer_type) && !hasOptions) {
      appendResult(opts.subject, { task_id: task.task_id, status: "skipped", skip_reason: "missing_options_in_source", needs_review: true, solved_at: new Date().toISOString() });
      autoSkipped++;
      continue;
    }
    if (hasUnsupportedAttachment(task)) {
      appendResult(opts.subject, { task_id: task.task_id, status: "skipped", skip_reason: "unsupported_attachment", needs_review: true, solved_at: new Date().toISOString() });
      autoSkipped++;
      continue;
    }
    if (!opts.withImages && hasImageAttachment(task)) continue; // отдельным батчем с --with-images

    const isAuto = AUTO_TYPES.has(task.answer_type);
    const isEssay = ESSAY_TYPES.has(task.answer_type);
    if (opts.bucket === "auto" && !isAuto) continue;
    if (opts.bucket === "essay" && !isEssay) continue;
    if (!isAuto && !isEssay) {
      appendResult(opts.subject, { task_id: task.task_id, status: "skipped", skip_reason: `unknown_answer_type:${task.answer_type}`, needs_review: true, solved_at: new Date().toISOString() });
      autoSkipped++;
      continue;
    }

    batch.push({
      task_id: task.task_id,
      answer_type: task.answer_type,
      bucket: isAuto ? "auto" : "essay",
      hint: isAuto ? ANSWER_TYPE_HINTS[task.answer_type] ?? "" : undefined,
      images: hasImageAttachment(task) ? (task.attachments ?? []).filter((a) => a.type === "image").map((a) => path.join(OUTPUT_DIR, opts.subject, a.path)) : [],
      text: cleanedText,
    });
  }

  console.error(`[${opts.subject}] всего=${all.length} ещё не решено=${pending.length} авто-пропущено сейчас=${autoSkipped} в батче=${batch.length}`);
  console.log(JSON.stringify(batch, null, 2));
}

main();
