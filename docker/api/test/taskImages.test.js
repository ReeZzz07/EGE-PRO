// Вложения к заданию для промпта ИИ-репетитора: формулы (SVG от Wiris с зашитым MathML в
// комментарии) разворачиваются в текст, растровые картинки идут в vision-блоки — не наоборот, и
// с ограничениями (макс. 4 картинки, vision только если провайдер это умеет). STORAGE_ROOT
// читается taskImages.js один раз при импорте модуля, поэтому переменную окружения выставляем
// ДО динамического import() (статический import в этом же файле выполнился бы раньше).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "taskimg-test-"));
process.env.STORAGE_ROOT = STORAGE_ROOT;
fs.mkdirSync(path.join(STORAGE_ROOT, "task-media"), { recursive: true });

const { buildTaskAttachments, buildUserContent, supportsVision } = await import("../taskImages.js");

function writeMedia(relPath, content) {
  const full = path.join(STORAGE_ROOT, "task-media", relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

test("supportsVision: anthropic — всегда true, независимо от модели", () => {
  assert.equal(supportsVision({ provider: "anthropic", model: "" }), true);
  assert.equal(supportsVision({ provider: "anthropic", model: "claude-opus" }), true);
});

test("supportsVision: qwen — true только для vl-моделей, регистронезависимо", () => {
  assert.equal(supportsVision({ provider: "qwen", model: "qwen-vl-max" }), true);
  assert.equal(supportsVision({ provider: "qwen", model: "QWEN-VL-PLUS" }), true);
  assert.equal(supportsVision({ provider: "qwen", model: "qwen-max" }), false);
  assert.equal(supportsVision({ provider: "qwen", model: "" }), false);
});

test("buildTaskAttachments: SVG с MathML-комментарием разворачивается в текст формулы, без vision-блока", () => {
  writeMedia("f1.svg", '<svg><!--MathML: <math><mi>x</mi></math>--></svg>');
  const { formulasText, imageBlocks } = buildTaskAttachments([{ storage_path: "f1.svg" }], true);
  assert.deepEqual(formulasText, ["<math><mi>x</mi></math>"]);
  assert.equal(imageBlocks.length, 0);
});

test("buildTaskAttachments: HTML-сущности в MathML декодируются", () => {
  writeMedia("f2.svg", "<svg><!-- MathML: a &lt; b &amp; c &gt; d --></svg>");
  const { formulasText } = buildTaskAttachments([{ storage_path: "f2.svg" }], true);
  assert.deepEqual(formulasText, ["a < b & c > d"]);
});

test("buildTaskAttachments: SVG без MathML-комментария — тихо пропускается (растеризации нет)", () => {
  writeMedia("f3.svg", "<svg><circle r='5'/></svg>");
  const { formulasText, imageBlocks } = buildTaskAttachments([{ storage_path: "f3.svg" }], true);
  assert.deepEqual(formulasText, []);
  assert.equal(imageBlocks.length, 0);
});

test("buildTaskAttachments: растровая картинка (PNG) — в imageBlocks с определённым по сигнатуре mime, когда vision разрешён", () => {
  writeMedia("pic.png", PNG_MAGIC);
  const { imageBlocks } = buildTaskAttachments([{ storage_path: "pic.png" }], true);
  assert.equal(imageBlocks.length, 1);
  assert.equal(imageBlocks[0].mime, "image/png");
});

test("buildTaskAttachments: allowVision=false — картинки не попадают в imageBlocks вовсе", () => {
  writeMedia("pic2.jpg", JPEG_MAGIC);
  const { imageBlocks } = buildTaskAttachments([{ storage_path: "pic2.jpg" }], false);
  assert.equal(imageBlocks.length, 0);
});

test("buildTaskAttachments: не больше 4 картинок, даже если вложений больше", () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    writeMedia(`many${i}.png`, PNG_MAGIC);
    rows.push({ storage_path: `many${i}.png` });
  }
  const { imageBlocks } = buildTaskAttachments(rows, true);
  assert.equal(imageBlocks.length, 4);
});

test("buildTaskAttachments: файл отсутствует на диске — пропускается молча, не падает", () => {
  const { formulasText, imageBlocks } = buildTaskAttachments([{ storage_path: "does-not-exist.png" }], true);
  assert.deepEqual(formulasText, []);
  assert.equal(imageBlocks.length, 0);
});

test("buildTaskAttachments: без вложений вовсе (undefined/[]) — пустой результат, не исключение", () => {
  assert.deepEqual(buildTaskAttachments(undefined, true), { formulasText: [], imageBlocks: [] });
  assert.deepEqual(buildTaskAttachments([], true), { formulasText: [], imageBlocks: [] });
});

test("buildUserContent: без вложений — исходный текст без изменений (форма запроса не меняется зря)", () => {
  const res = buildUserContent("anthropic", "просто текст", { formulasText: [], imageBlocks: [] });
  assert.equal(res, "просто текст");
});

test("buildUserContent: только формулы (без картинок) — остаётся строкой с припиской, не массивом блоков", () => {
  const res = buildUserContent("anthropic", "вопрос", { formulasText: ["x^2"], imageBlocks: [] });
  assert.equal(typeof res, "string");
  assert.match(res, /Формулы на иллюстрациях.*x\^2/s);
  assert.match(res, /вопрос$/);
});

test("buildUserContent: картинки + anthropic — массив блоков image+text, кэш только на последней картинке", () => {
  const attachments = { formulasText: [], imageBlocks: [{ mime: "image/png", base64: "AAA" }, { mime: "image/jpeg", base64: "BBB" }] };
  const res = buildUserContent("anthropic", "вопрос", attachments);
  assert.equal(res.length, 3); // 2 картинки + 1 текстовый блок
  assert.equal(res[0].type, "image");
  assert.equal(res[0].cache_control, undefined);
  assert.equal(res[1].cache_control?.type, "ephemeral");
  assert.equal(res[2].type, "text");
});

test("buildUserContent: картинки + qwen — формат image_url вместо anthropic-блоков", () => {
  const attachments = { formulasText: [], imageBlocks: [{ mime: "image/png", base64: "AAA" }] };
  const res = buildUserContent("qwen", "вопрос", attachments);
  assert.equal(res[0].type, "image_url");
  assert.match(res[0].image_url.url, /^data:image\/png;base64,AAA$/);
});
