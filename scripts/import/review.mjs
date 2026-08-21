#!/usr/bin/env node
// Читаемый вывод результатов калибровки бок о бок с исходным условием — чтобы глазами
// оценить качество решений, прежде чем запускать весь корпус.
//
// Использование: node scripts/import/review.mjs [--subjects=biologiya,fizika] [--only-review]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTaskHtml } from "./lib/clean-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(ROOT, "output");

const args = process.argv.slice(2);
const subjArg = args.find((a) => a.startsWith("--subjects="));
const subjects = subjArg
  ? subjArg.slice("--subjects=".length).split(",")
  : fs.readdirSync(OUTPUT_DIR).filter((d) => fs.existsSync(path.join(OUTPUT_DIR, d, "tasks.answered.jsonl")));
const onlyReview = args.includes("--only-review");

let total = 0,
  solved = 0,
  needsReview = 0,
  errors = 0;

for (const subject of subjects) {
  const answeredPath = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  if (!fs.existsSync(answeredPath)) continue;
  const tasksById = new Map(
    fs
      .readFileSync(path.join(OUTPUT_DIR, subject, "tasks.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((t) => [t.task_id, t])
  );
  const resultsById = new Map();
  for (const line of fs.readFileSync(answeredPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    resultsById.set(r.task_id, r); // дозапись без дедупа в файле — последняя строка по task_id побеждает
  }
  const results = [...resultsById.values()];

  for (const r of results) {
    total++;
    if (r.status === "solved") solved++;
    if (r.needs_review) needsReview++;
    if (r.status === "error") errors++;
    if (onlyReview && !r.needs_review) continue;

    const task = tasksById.get(r.task_id);
    const { text } = task ? cleanTaskHtml(task.body_html, task.variants) : { text: "(исходное задание не найдено)" };

    console.log("\n" + "─".repeat(78));
    console.log(`[${subject}] ${r.task_id} · тип: ${task?.answer_type ?? "?"} · статус: ${r.status} · confidence: ${r.confidence ?? "-"}${r.needs_review ? " · НА ПРОВЕРКУ" : ""}`);
    console.log("УСЛОВИЕ:\n" + text.slice(0, 600) + (text.length > 600 ? "…" : ""));
    if (r.status === "error") {
      console.log("ОШИБКА:", r.error);
    } else if (r.status === "skipped") {
      console.log("ПРОПУЩЕНО:", r.skip_reason);
    } else if (r.bucket === "auto") {
      console.log("ОТВЕТ:", r.answer);
      console.log("РЕШЕНИЕ:", (r.explanation ?? "").slice(0, 400));
    } else if (r.bucket === "essay") {
      console.log("КРИТЕРИИ:", JSON.stringify(r.criteria));
      console.log("ЗАМЕТКИ:", r.notes);
    }
  }
}

console.log("\n" + "═".repeat(78));
console.log(`ИТОГО обработано: ${total} | solved: ${solved} | на проверку: ${needsReview} | ошибок: ${errors}`);
