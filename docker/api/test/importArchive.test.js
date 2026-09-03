// Тесты парсинга ZIP-архивов ручного импорта заданий (importArchive.js, см. AdminTaskImport.tsx).
// Ни одна из внутренних функций (stripHtml, parseShortAnswer, parseCriteria, buildGenericRow,
// buildNeoFamilyRow...) не экспортируется — тестируем через единственный публичный вход,
// parseImportArchive(), настоящими ZIP-буферами (та же связка parse+adm-zip, что и живой
// смоук-тест этой сессии при обновлении adm-zip до 0.6.0, только теперь закреплено тестом на
// конкретные случаи, а не разовой проверкой руками).
import { test } from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { parseImportArchive } from "../importArchive.js";

function buildZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));
  }
  return zip.toBuffer();
}

// ─────────────────────── общая схема (tasks.json) ───────────────────────

test("generic-схема: минимальное задание с ответом — published, needs_review=false", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify([{ id: "1", topic: "Тема", statement: "Условие", answer: "42", points: 3 }]) });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "rus-manual-1");
  assert.equal(rows[0].bucket, "auto");
  assert.equal(rows[0].answer, "42");
  assert.equal(rows[0].needs_review, false);
  assert.equal(rows[0].published, true);
});

test("generic-схема: без ответа — needs_review=true, published=false (не публикуем непроверенное)", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify([{ id: "1", topic: "Тема", statement: "Условие" }]) });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows[0].needs_review, true);
  assert.equal(rows[0].published, false);
});

test("generic-схема: criteria делает bucket=essay и needs_review=false", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([{ id: "2", topic: "Сочинение", statement: ["Абзац 1", "Абзац 2"], criteria: [{ code: "К1", name: "Проблема", max: 2 }] }]),
  });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows[0].bucket, "essay");
  assert.equal(rows[0].needs_review, false);
  assert.equal(rows[0].statement, "Абзац 1\nАбзац 2"); // массив абзацев склеен переносами
});

test("generic-схема: bucket=essay без критериев — needs_review=true (нечего проверять по критериям)", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify([{ id: "3", topic: "Т", statement: "У", bucket: "essay" }]) });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows[0].bucket, "essay");
  assert.equal(rows[0].needs_review, true);
});

test("generic-схема: без id — детерминированный id из индекса и slugify(topic)", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify([{ topic: "Логарифмы и Показатели!", statement: "У", answer: "1" }]) });
  const { rows } = parseImportArchive(buf, "math");
  assert.equal(rows[0].id, "math-manual-0-логарифмы-и-показатели");
});

test("generic-схема: картинка резолвится по пути из JSON независимо от регистра/слэшей", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([{ id: "1", topic: "Т", statement: "У", answer: "1", images: ["Pics\\a.PNG"] }]),
    "pics/a.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const { rows, mediaByTaskId } = parseImportArchive(buf, "geo");
  const media = mediaByTaskId.get(rows[0].id);
  assert.equal(media?.length, 1);
  assert.equal(media[0].zipPath, "pics/a.png"); // реальное имя записи в архиве, не то, что было в JSON
  assert.equal(media[0].position, 0);
});

test("generic-схема: картинка без соответствующего файла в архиве — просто пропускается, не падает", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify([{ id: "1", topic: "Т", statement: "У", answer: "1", images: ["missing.png"] }]) });
  const { rows, mediaByTaskId } = parseImportArchive(buf, "geo");
  assert.equal(mediaByTaskId.has(rows[0].id), false);
});

// ─────────────────────── формат файла: jsonl / BOM / ошибки ───────────────────────

test("tasks.jsonl — построчный формат, каждая строка отдельное задание", () => {
  const lines = [JSON.stringify({ id: "1", topic: "А", statement: "У1", answer: "1" }), JSON.stringify({ id: "2", topic: "Б", statement: "У2", answer: "2" })];
  const buf = buildZip({ "tasks.jsonl": lines.join("\n") });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["rus-manual-1", "rus-manual-2"]);
});

test("tasks.json с UTF-8 BOM в начале файла — парсится, не падает на JSON.parse", () => {
  const json = "﻿" + JSON.stringify([{ id: "1", topic: "Т", statement: "У", answer: "1" }]);
  const buf = buildZip({ "tasks.json": json });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows.length, 1);
});

test("tasks.json — не массив — понятная ошибка, а не сырое исключение JSON", () => {
  const buf = buildZip({ "tasks.json": JSON.stringify({ id: "1" }) });
  assert.throws(() => parseImportArchive(buf, "rus"), /должен быть массивом/);
});

test("нет ни tasks.json, ни tasks.jsonl — понятная ошибка", () => {
  const buf = buildZip({ "readme.txt": "не то" });
  assert.throws(() => parseImportArchive(buf, "rus"), /не найден tasks\.json/);
});

// ─────────────────────── NeoFamily-схема (question_html/answer_html) ───────────────────────

test("NeoFamily-схема: HTML в question_html очищается, короткий ответ и разбор извлекаются из answer_html", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([
      {
        task_id: "77",
        themes: [{ name: "Проценты", section: { name: "Алгебра" } }],
        task_line: { name: "12", value: 2 },
        answer_type: "short",
        question_html: "<p>Найдите <b>значение</b> выражения.</p>",
        answer_html: "Решение: считаем по формуле. Ответ: 15 Источник: ФИПИ банк 2024",
      },
    ]),
  });
  const { rows } = parseImportArchive(buf, "math");
  const row = rows[0];
  assert.equal(row.id, "math-manual-77");
  assert.equal(row.topic, "Проценты");
  assert.equal(row.section, "Алгебра");
  assert.equal(row.ege_number, 12);
  assert.equal(row.points, 2);
  assert.equal(row.bucket, "auto");
  assert.equal(row.statement, "Найдите значение выражения."); // без тегов
  assert.equal(row.answer, "15");
  assert.equal(row.explanation, "считаем по формуле.");
  assert.equal(row.needs_review, false);
});

test("NeoFamily-схема: answer_type=full — bucket=essay, критерии парсятся из «Элементы ключа»", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([
      {
        task_id: "88",
        themes: [{ name: "Сочинение-рассуждение" }],
        answer_type: "full",
        question_html: "<p>Напишите сочинение.</p>",
        answer_html: "Элементы ключа:<br>1) формулировка проблемы;<br>2) позиция автора;<br>Источник: ФИПИ",
      },
    ]),
  });
  const { rows } = parseImportArchive(buf, "rus");
  const row = rows[0];
  assert.equal(row.bucket, "essay");
  assert.equal(row.needs_review, false);
  assert.deepEqual(row.criteria, [
    { code: "К1", name: "формулировка проблемы", max: 1 },
    { code: "К2", name: "позиция автора", max: 1 },
  ]);
});

test("NeoFamily-схема: короткий ответ без «Ответ:» в тексте — needs_review=true, ушёл на ручную проверку", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([
      { task_id: "1", themes: [{ name: "Т" }], answer_type: "short", question_html: "<p>Условие</p>", answer_html: "Тут просто пояснение без конкретики." },
    ]),
  });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows[0].needs_review, true);
  assert.equal(rows[0].published, false);
});

// Регресс-тест: маркеры ("Ответ", "Источник", "Элементы ключа") требуют двоеточие сразу после
// слова — иначе случайное упоминание "ответ" внутри обычного пояснения (не как разметка поля)
// ошибочно резало explanation/answer по этому месту и выставляло needs_review=false, хотя явного
// ответа в тексте не было (задание уходило в публикацию без ручной проверки). Было исправлено —
// см. parseShortAnswer/parseCriteria в importArchive.js.
test("NeoFamily-схема: слово «ответ» внутри пояснения без двоеточия — не маркер, needs_review=true", () => {
  const buf = buildZip({
    "tasks.json": JSON.stringify([
      { task_id: "2", themes: [{ name: "Т" }], answer_type: "short", question_html: "<p>Условие</p>", answer_html: "Чтобы получить верный ответ, подставь х=2." },
    ]),
  });
  const { rows } = parseImportArchive(buf, "rus");
  assert.equal(rows[0].needs_review, true);
  assert.equal(rows[0].published, false);
  assert.equal(rows[0].answer, null);
});
