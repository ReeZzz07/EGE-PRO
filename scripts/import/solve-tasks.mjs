#!/usr/bin/env node
// Батч-решение заданий из output/<subject>/tasks.jsonl через Claude API.
// Для каждого задания: 2 независимых решения → сравнение → при расхождении third-party
// арбитраж. Для заданий с развёрнутым ответом — черновик критериев (всегда на проверку методиста).
// Результат — output/<subject>/tasks.answered.jsonl (по одной строке на задание, дозаписью,
// так что скрипт можно прерывать и перезапускать — уже решённые задания не трогаются повторно).
//
// Провайдер выбирается через SOLVER_PROVIDER=anthropic (по умолчанию) | qwen — см. lib/provider.mjs.
//
// Использование (Anthropic):
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/import/solve-tasks.mjs --dry-run
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/import/solve-tasks.mjs --subjects=biologiya --limit=20
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/import/solve-tasks.mjs --concurrency=6
//
// Использование (Qwen / Alibaba Cloud DashScope):
//   SOLVER_PROVIDER=qwen DASHSCOPE_API_KEY=sk-... node scripts/import/solve-tasks.mjs --limit=3

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callWithTool, imageBlock, textBlock, usageSummary, MODEL, ENV_KEY_NAME, PROVIDER_NAME } from "./lib/provider.mjs";
import { cleanTaskHtml, OPTION_DEPENDENT_TYPES } from "./lib/clean-html.mjs";
import { answersMatch } from "./lib/answer-normalize.mjs";

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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { subjects: null, limit: Infinity, concurrency: 4, dryRun: args.includes("--dry-run") };
  for (const a of args) {
    if (a.startsWith("--subjects=")) opts.subjects = a.slice("--subjects=".length).split(",");
    if (a.startsWith("--limit=")) opts.limit = Number(a.slice("--limit=".length));
    if (a.startsWith("--concurrency=")) opts.concurrency = Number(a.slice("--concurrency=".length));
  }
  return opts;
}

function listSubjects(filter) {
  const all = fs.readdirSync(OUTPUT_DIR).filter((d) => fs.existsSync(path.join(OUTPUT_DIR, d, "tasks.jsonl")));
  return filter ? all.filter((s) => filter.includes(s)) : all;
}

function loadTasks(subject) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.jsonl");
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function loadDone(subject) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  if (!fs.existsSync(p)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      ids.add(JSON.parse(line).task_id);
    } catch {
      /* повреждённая строка — игнорируем, задание переобработается */
    }
  }
  return ids;
}

function appendResult(subject, record) {
  const p = path.join(OUTPUT_DIR, subject, "tasks.answered.jsonl");
  fs.appendFileSync(p, JSON.stringify(record) + "\n");
}

function mediaTypeFor(ext) {
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }[ext];
}

function hasUnsupportedAttachment(task) {
  return (task.attachments ?? []).some((att) => {
    if (att.type !== "image") return true;
    return !IMAGE_EXT.has(path.extname(att.path).toLowerCase());
  });
}

function buildImages(subject, task) {
  const blocks = [];
  for (const att of task.attachments ?? []) {
    if (att.type !== "image") continue;
    const ext = path.extname(att.path).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const full = path.join(OUTPUT_DIR, subject, att.path);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).size > 4.5 * 1024 * 1024) continue; // защита от превышения лимита API на размер картинки
    blocks.push(imageBlock(fs.readFileSync(full).toString("base64"), mediaTypeFor(ext)));
    if (blocks.length >= 4) break;
  }
  return blocks;
}

const SOLVE_SYSTEM = `Ты — опытный эксперт-методист по подготовке к ЕГЭ/ОГЭ. Тебе даётся задание из открытого банка заданий ФИПИ (условие извлечено автоматически из HTML — не удивляйся возможным артефактам форматирования). Реши задание самостоятельно и точно. Дай краткое пошаговое решение и финальный ответ строго в формате, ожидаемом в бланке ответов ФИПИ (в самом ответе — без лишних слов и пояснений). Если не уверен — честно отметь это через поле confidence, не выдумывай факты и числа.`;

const ANSWER_TYPE_HINTS = {
  short: "Тип ответа: краткий (число, слово или словосочетание). В поле answer — только это значение, как его нужно вписать в бланк.",
  matching: "Тип ответа: установление соответствия. В поле answer — цифры без пробелов и разделителей, по порядку букв (пример: 1324).",
  "Последовательность": "Тип ответа: последовательность. В поле answer — цифры в правильном порядке без пробелов.",
  "Расстановка терминов": "Тип ответа: расстановка терминов по порядку. В поле answer — цифры/буквы в правильном порядке без пробелов.",
  "Выбор ответов из предложенных вариантов": "Тип ответа: выбор одного или нескольких вариантов. В поле answer — цифры выбранных вариантов без пробелов, по возрастанию.",
  select_one: "Тип ответа: выбор одного варианта. В поле answer — цифра выбранного варианта.",
  "Распределение": "Тип ответа: распределение по группам. В поле answer — цифры без пробелов в требуемом порядке.",
};

const SOLVE_TOOL = {
  name: "submit_solution",
  description: "Отправить решение задания",
  input_schema: {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      answer: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["reasoning", "answer", "confidence"],
  },
};

const ADJUDICATE_TOOL = {
  name: "submit_verdict",
  description: "Определить, какой из двух вариантов ответа верный",
  input_schema: {
    type: "object",
    properties: {
      correct_answer: { type: "string", description: "итоговый верный ответ в формате бланка ФИПИ; пустая строка, если оба неверны/невозможно определить" },
      certain: { type: "boolean" },
      reasoning: { type: "string" },
    },
    required: ["correct_answer", "certain", "reasoning"],
  },
};

const ESSAY_SYSTEM = `Ты — эксперт-методист ЕГЭ/ОГЭ. Для задания с развёрнутым ответом составь критерии оценивания, максимально приближенные к официальным критериям ФИПИ для этого типа задания (учитывай предмет, формулировку и контекст). НЕ пиши сам ответ/сочинение/пример решения — только рубрику проверки для другого ИИ-проверяющего.`;

const ESSAY_TOOL = {
  name: "submit_criteria",
  description: "Отправить критерии оценивания развёрнутого ответа",
  input_schema: {
    type: "object",
    properties: {
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: { code: { type: "string" }, name: { type: "string" }, max: { type: "number" } },
          required: ["code", "name", "max"],
        },
      },
      minWords: { type: ["number", "null"] },
      notes: { type: "string" },
    },
    required: ["criteria", "notes"],
  },
};

async function solveAuto(apiKey, cleanedText, answerType, images) {
  const hint = ANSWER_TYPE_HINTS[answerType] ?? "";
  const userText = `${cleanedText}\n\n${hint}`;
  const content = [textBlock(userText), ...images];

  const first = await callWithTool({ apiKey, system: SOLVE_SYSTEM, content, tool: SOLVE_TOOL });
  const second = await callWithTool({ apiKey, system: SOLVE_SYSTEM, content, tool: SOLVE_TOOL });

  if (answersMatch(first.answer, second.answer)) {
    return {
      answer: first.answer,
      explanation: first.reasoning,
      confidence: first.confidence === "high" && second.confidence === "high" ? "high" : "medium",
      needs_review: false,
    };
  }

  const adjContent = [
    textBlock(
      `${userText}\n\n--- Вариант 1 ---\nОтвет: ${first.answer}\nРешение: ${first.reasoning}\n\n--- Вариант 2 ---\nОтвет: ${second.answer}\nРешение: ${second.reasoning}\n\nДва независимых решения разошлись. Реши задание заново с нуля и определи, какой вариант верный (или предложи третий, если оба неверны).`
    ),
    ...images,
  ];
  const verdict = await callWithTool({ apiKey, system: SOLVE_SYSTEM, content: adjContent, tool: ADJUDICATE_TOOL });

  return {
    answer: verdict.correct_answer || first.answer,
    explanation: verdict.reasoning,
    confidence: verdict.certain && verdict.correct_answer ? "medium" : "low",
    needs_review: true, // расхождение решений — в любом случае ручная проверка методиста
  };
}

async function solveEssay(apiKey, cleanedText, images) {
  const content = [textBlock(cleanedText), ...images];
  const result = await callWithTool({ apiKey, system: ESSAY_SYSTEM, content, tool: ESSAY_TOOL, maxTokens: 1200 });
  return { criteria: result.criteria, minWords: result.minWords ?? null, notes: result.notes };
}

async function processTask(apiKey, subject, task) {
  const { text, hasOptions } = cleanTaskHtml(task.body_html, task.variants);
  const cleanedText = text || "(пустое условие после очистки HTML)";

  if (OPTION_DEPENDENT_TYPES.has(task.answer_type) && !hasOptions) {
    return { task_id: task.task_id, status: "skipped", skip_reason: "missing_options_in_source", needs_review: true, solved_at: new Date().toISOString() };
  }

  if (hasUnsupportedAttachment(task)) {
    return { task_id: task.task_id, status: "skipped", skip_reason: "unsupported_attachment", needs_review: true, solved_at: new Date().toISOString() };
  }

  const images = buildImages(subject, task);

  try {
    if (AUTO_TYPES.has(task.answer_type)) {
      const r = await solveAuto(apiKey, cleanedText, task.answer_type, images);
      return {
        task_id: task.task_id,
        status: "solved",
        bucket: "auto",
        answer: r.answer,
        explanation: r.explanation,
        confidence: r.confidence,
        needs_review: r.needs_review,
        model: MODEL,
        solved_at: new Date().toISOString(),
      };
    }
    if (ESSAY_TYPES.has(task.answer_type)) {
      const r = await solveEssay(apiKey, cleanedText, images);
      return {
        task_id: task.task_id,
        status: "solved",
        bucket: "essay",
        criteria: r.criteria,
        minWords: r.minWords,
        notes: r.notes,
        confidence: "needs_review",
        needs_review: true,
        model: MODEL,
        solved_at: new Date().toISOString(),
      };
    }
    return { task_id: task.task_id, status: "skipped", skip_reason: `unknown_answer_type:${task.answer_type}`, needs_review: true, solved_at: new Date().toISOString() };
  } catch (e) {
    return { task_id: task.task_id, status: "error", error: String(e?.message ?? e), needs_review: true, solved_at: new Date().toISOString() };
  }
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  let active = 0;
  let done = 0;
  return new Promise((resolve) => {
    function next() {
      if (idx >= items.length && active === 0) return resolve();
      while (active < concurrency && idx < items.length) {
        const item = items[idx++];
        active++;
        worker(item)
          .catch((e) => console.error("\nworker error:", e))
          .finally(() => {
            active--;
            done++;
            if (done % 10 === 0 || done === items.length) process.stdout.write(`\r  прогресс: ${done}/${items.length}   `);
            next();
          });
      }
    }
    next();
  });
}

async function main() {
  const opts = parseArgs();
  const apiKey = process.env[ENV_KEY_NAME];
  if (!apiKey && !opts.dryRun) {
    console.error(`Нужен ${ENV_KEY_NAME} в окружении (провайдер: ${PROVIDER_NAME}). Пример: ${ENV_KEY_NAME}=... node scripts/import/solve-tasks.mjs`);
    process.exit(1);
  }

  const subjects = listSubjects(opts.subjects);
  console.log(`Модель: ${MODEL}`);
  console.log(`Предметы (${subjects.length}): ${subjects.join(", ")}`);

  let grandTotal = 0,
    grandAuto = 0,
    grandEssay = 0,
    grandSkip = 0;

  for (const subject of subjects) {
    const all = loadTasks(subject);
    const done = loadDone(subject);
    const remaining = all.filter((t) => !done.has(t.task_id));
    const pending = Number.isFinite(opts.limit) ? remaining.slice(0, opts.limit) : remaining;

    const autoCount = pending.filter((t) => AUTO_TYPES.has(t.answer_type)).length;
    const essayCount = pending.filter((t) => ESSAY_TYPES.has(t.answer_type)).length;
    const attachSkip = pending.filter((t) => hasUnsupportedAttachment(t)).length;
    const missingOptCount = pending.filter((t) => OPTION_DEPENDENT_TYPES.has(t.answer_type) && !cleanTaskHtml(t.body_html, t.variants).hasOptions).length;
    const skipCount = attachSkip + missingOptCount;
    const otherCount = pending.length - autoCount - essayCount;

    grandTotal += pending.length;
    grandAuto += autoCount;
    grandEssay += essayCount;
    grandSkip += skipCount;

    console.log(
      `\n[${subject}] всего=${all.length} уже готово=${done.size} к обработке=${pending.length} (auto=${autoCount}, essay=${essayCount}, неизв.тип=${otherCount}, без вариантов в источнике=${missingOptCount}, неподдерж.вложение=${attachSkip})`
    );

    if (opts.dryRun || pending.length === 0) continue;

    await runPool(
      pending,
      async (task) => {
        const record = await processTask(apiKey, subject, task);
        appendResult(subject, record);
      },
      opts.concurrency
    );
    console.log();
  }

  console.log(`\nИТОГО к обработке: ${grandTotal} (auto=${grandAuto}, essay=${grandEssay}, пропущено без варианта/вложения=${grandSkip})`);
  if (!opts.dryRun) {
    const u = usageSummary();
    console.log(`Вызовов API: ${u.totalCalls} | входных токенов: ${u.totalInputTokens} | выходных: ${u.totalOutputTokens}`);
  }
}

main();
