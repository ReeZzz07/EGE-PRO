// Ручной импорт банка заданий из ZIP-архива (админка → «Импорт» — см. AdminTaskImport.tsx).
// Формат архива — см. README-блок в самом компоненте UI (или SETUP.md): либо tasks.json/tasks.jsonl
// с задания в собственной схеме (topic/statement/answer/...), либо в схеме агрегатора NeoFamily
// (question_html/answer_html с маркерами "Решение:"/"Ответ:"/"Элементы ключа:") — автоопределяется
// по наличию поля question_html. Логика разбора NeoFamily-схемы намеренно продублирована из
// scripts/import/publish-neofamily.mjs (тот работает как отдельный CLI-скрипт вне Docker-сборки api,
// делить с ним модуль через границу контекстов сборки — лишняя сложность ради небольшого файла).
import AdmZip from "adm-zip";

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
// "ответ"/"источник"/"элементы ключа" где угодно в обычном тексте пояснения (например "...чтобы
// получить верный ответ, подставь...") как будто это разметка поля, и обрубают explanation/answer
// не там — см. docker/api/test/importArchive.test.js, тест на этот класс ошибки.
function parseShortAnswer(answerHtml) {
  let text = stripHtml(answerHtml);
  text = text.split(/Источник\s*:/i)[0];
  const idx = text.search(/Ответ\s*:/i);
  if (idx === -1) return { answer: null, explanation: text.trim() || null };
  const explanation = text.slice(0, idx).replace(/^Решение\s*:/i, "").trim();
  const answerRaw = text.slice(idx).replace(/^Ответ\s*:/i, "").trim();
  return { answer: answerRaw || null, explanation: explanation || null };
}

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

function slugify(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Одна запись NeoFamily-схемы (question_html/answer_html) → строка public.tasks + список медиа. */
function buildNeoFamilyRow(t, subject, index, zipEntryNames) {
  const id = t.task_id ? `${subject}-manual-${t.task_id}` : `${subject}-manual-${index}-${slugify(t.themes?.[0]?.name)}`;
  const theme = t.themes?.[0];
  const topic = theme?.name ?? subject;
  const section = theme?.section?.name ?? null;
  const bucket = t.answer_type === "full" ? "essay" : "auto";
  const statement = stripHtml(t.question_html ?? "") || "(пустое условие)";
  const points = Number.isFinite(t.task_line?.value) ? t.task_line.value : 2;
  const egeNumRaw = t.task_line?.name;
  const ege_number = egeNumRaw != null && /^\d+$/.test(String(egeNumRaw)) ? Number(egeNumRaw) : null;

  let answer = null, explanation = null, criteria = null, hints, needs_review = false;
  if (bucket === "auto") {
    const parsed = parseShortAnswer(t.answer_html ?? "");
    answer = parsed.answer;
    explanation = parsed.explanation;
    if (!answer) needs_review = true;
    hints = buildHints(topic, explanation, answer);
  } else {
    criteria = parseCriteria(t.answer_html ?? "");
    if (!criteria) needs_review = true;
    hints = buildEssayHints(topic, criteria);
  }

  const media = [];
  const imgs = (t.attachments ?? []).filter((a) => a.type === "image");
  let pos = 0;
  for (const att of imgs) {
    const realName = resolveZipPath(zipEntryNames, att.path);
    if (!realName) continue;
    media.push({ zipPath: realName, position: pos });
    pos++;
    if (pos >= 6) break;
  }

  return {
    row: { id, subject, topic, section, ege_number, answer_type: t.answer_type ?? null, bucket, points, statement, options: null, answer, explanation, hints, criteria, min_words: null, confidence: null, needs_review, published: !needs_review, source: "manual_archive" },
    media,
  };
}

/** Одна запись «общей» схемы (уже готовые поля, как в public.tasks) → строка + медиа. */
function buildGenericRow(t, subject, index, zipEntryNames) {
  const id = t.id ? `${subject}-manual-${t.id}` : `${subject}-manual-${index}-${slugify(t.topic)}`;
  const bucket = t.bucket === "essay" || (Array.isArray(t.criteria) && t.criteria.length) ? "essay" : "auto";
  const statement = Array.isArray(t.statement) ? t.statement.join("\n") : String(t.statement ?? "").trim();
  const needs_review = bucket === "essay" ? !(t.criteria && t.criteria.length) : !t.answer;

  const media = [];
  let pos = 0;
  for (const imgPath of t.images ?? []) {
    const realName = resolveZipPath(zipEntryNames, imgPath);
    if (!realName) continue;
    media.push({ zipPath: realName, position: pos });
    pos++;
    if (pos >= 6) break;
  }

  return {
    row: {
      id,
      subject: t.subject ?? subject,
      topic: t.topic || "(без темы)",
      section: t.section ?? null,
      ege_number: Number.isFinite(t.ege_number) ? t.ege_number : null,
      answer_type: t.answer_type ?? null,
      bucket,
      points: Number.isFinite(t.points) ? t.points : 2,
      statement: statement || "(пустое условие)",
      options: t.options ?? null,
      answer: t.answer ?? null,
      explanation: Array.isArray(t.explanation) ? t.explanation.join("\n") : (t.explanation ?? null),
      hints: Array.isArray(t.hints) && t.hints.length ? t.hints.slice(0, 3) : buildHints(t.topic || "", Array.isArray(t.explanation) ? t.explanation.join(" ") : (t.explanation ?? ""), t.answer),
      criteria: t.criteria ?? null,
      min_words: Number.isFinite(t.min_words) ? t.min_words : null,
      confidence: null,
      needs_review,
      published: !needs_review,
      source: "manual_archive",
    },
    media,
  };
}

/** Windows-инструменты (Compress-Archive, «Отправить → сжатая ZIP-папка») пишут пути с `\`, а не
 *  `/` — приводим все имена записей к единому виду, чтобы сопоставление по пути из JSON работало
 *  независимо от того, чем архив был собран. */
function normalizeZipPath(p) {
  return p.replace(/\\/g, "/");
}

function readEntries(zip) {
  const names = new Map(); // normalized-lowercase (forward slashes) -> real entryName
  for (const e of zip.getEntries()) if (!e.isDirectory) names.set(normalizeZipPath(e.entryName).toLowerCase(), e.entryName);
  const findByBasename = (base) => [...names.entries()].find(([norm]) => norm.endsWith("/" + base) || norm === base)?.[1];
  return { zip, names, findByBasename };
}

/** Находит реальное имя записи в архиве по пути из JSON, независимо от `\`/`/` и регистра. */
function resolveZipPath(names, jsonPath) {
  const norm = normalizeZipPath(String(jsonPath ?? "")).replace(/^\/+/, "").toLowerCase();
  return names.get(norm) ?? null;
}

/** Windows-редакторы часто пишут UTF-8 с BOM — JSON.parse от него падает. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseTaskListEntry(zip) {
  const { names, findByBasename } = readEntries(zip);
  const jsonlName = findByBasename("tasks.jsonl");
  const jsonName = findByBasename("tasks.json");
  if (jsonlName) {
    const text = stripBom(zip.readAsText(jsonlName));
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  }
  if (jsonName) {
    const text = stripBom(zip.readAsText(jsonName));
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("tasks.json должен быть массивом заданий");
    return data;
  }
  throw new Error("В архиве не найден tasks.json или tasks.jsonl (в корне архива)");
}

/**
 * @param {Buffer} zipBuffer
 * @param {string} subject
 * @returns {{ rows: object[], mediaByTaskId: Map<string, {zipPath:string, position:number}[]>, zip: AdmZip }}
 */
export function parseImportArchive(zipBuffer, subject) {
  const zip = new AdmZip(zipBuffer);
  const entries = readEntries(zip);
  const raw = parseTaskListEntry(zip);

  const rows = [];
  const mediaByTaskId = new Map();
  raw.forEach((t, i) => {
    const { row, media } = t.question_html !== undefined ? buildNeoFamilyRow(t, subject, i, entries.names) : buildGenericRow(t, subject, i, entries.names);
    rows.push(row);
    if (media.length) mediaByTaskId.set(row.id, media);
  });

  return { rows, mediaByTaskId, zip };
}

export function readZipFile(zip, zipPath) {
  const entry = zip.getEntry(zipPath);
  if (!entry) return null;
  return zip.readFile(entry);
}
