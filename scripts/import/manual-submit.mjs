#!/usr/bin/env node
// Принимает JSON-массив решений, подготовленных ВРУЧНУЮ (Claude в чате, без вызова какого-либо
// LLM API), и дописывает их в output/<subject>/tasks.answered.jsonl в том же формате, который
// использует processTask() из solve-tasks.mjs — чтобы review.mjs и будущий шаг публикации
// не отличали ручные решения от API-шных.
//
// Формат входного файла — массив объектов:
//   auto:  { task_id, bucket: "auto", answer, explanation, confidence: "high"|"medium"|"low" }
//   essay: { task_id, bucket: "essay", criteria: [{code,name,max}], minWords, notes }
//
// Использование:
//   node scripts/import/manual-submit.mjs --subject=biologiya --file=batch-solved.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(ROOT, "output");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (const a of args) {
    if (a.startsWith("--subject=")) opts.subject = a.slice("--subject=".length);
    if (a.startsWith("--file=")) opts.file = a.slice("--file=".length);
  }
  if (!opts.subject || !opts.file) {
    console.error("Нужны --subject=<имя> --file=<путь к json с решениями>");
    process.exit(1);
  }
  return opts;
}

function appendResult(subject, record) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  fs.appendFileSync(p, JSON.stringify(record) + "\n");
}

function main() {
  const opts = parseArgs();
  const items = JSON.parse(fs.readFileSync(opts.file, "utf8"));
  if (!Array.isArray(items)) {
    console.error("Файл должен содержать JSON-массив решений");
    process.exit(1);
  }

  let auto = 0,
    essay = 0;

  for (const item of items) {
    if (!item.task_id || !item.bucket) throw new Error(`Некорректная запись (нет task_id/bucket): ${JSON.stringify(item)}`);

    if (item.bucket === "auto") {
      if (!item.answer || !item.confidence) throw new Error(`auto-запись ${item.task_id}: нужны answer и confidence`);
      appendResult(opts.subject, {
        task_id: item.task_id,
        status: "solved",
        bucket: "auto",
        answer: item.answer,
        explanation: item.explanation ?? "",
        confidence: item.confidence,
        needs_review: item.needs_review ?? false,
        model: "manual-claude",
        solved_at: new Date().toISOString(),
      });
      auto++;
    } else if (item.bucket === "skip") {
      appendResult(opts.subject, {
        task_id: item.task_id,
        status: "skipped",
        skip_reason: item.skip_reason ?? "manual_skip",
        needs_review: true,
        solved_at: new Date().toISOString(),
      });
      auto++; // считаем в той же сводке, что и auto — отдельный счётчик не заводим ради простоты
    } else if (item.bucket === "essay") {
      if (!item.criteria) throw new Error(`essay-запись ${item.task_id}: нужны criteria`);
      appendResult(opts.subject, {
        task_id: item.task_id,
        status: "solved",
        bucket: "essay",
        criteria: item.criteria,
        minWords: item.minWords ?? null,
        notes: item.notes ?? "",
        confidence: "needs_review",
        needs_review: true,
        model: "manual-claude",
        solved_at: new Date().toISOString(),
      });
      essay++;
    } else {
      throw new Error(`Неизвестный bucket у ${item.task_id}: ${item.bucket}`);
    }
  }

  console.log(`[${opts.subject}] дозаписано: auto=${auto} essay=${essay}`);
}

main();
