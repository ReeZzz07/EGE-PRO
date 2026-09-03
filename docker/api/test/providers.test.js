// callText/callTool — провайдер-независимый вызов модели (Anthropic/Qwen), включая ретраи и
// автообход конфликта tool_choice+thinking-mode у Qwen3 (см. комментарий в providers.js — это
// уже однажды найденный в другом проекте баг, портированный сюда вместе с фиксом). fetch и
// setTimeout подменяются на весь файл — реальные сетевые вызовы и реальные паузы здесь не нужны
// и не должны замедлять прогон (без подмены setTimeout ретраи Qwen суммарно спали бы секундами).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callText, callTool } from "../providers.js";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
let fetchCalls;
let responses;

beforeEach(() => {
  fetchCalls = [];
  responses = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("test: no more mocked responses queued");
    return next;
  };
  // ретраи в providers.js ждут через setTimeout — исполняем колбэк сразу, без реальной паузы
  globalThis.setTimeout = (fn) => { fn(); return 0; };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const anthropicSettings = { provider: "anthropic", apiKey: "key", model: "" };
const qwenSettings = { provider: "qwen", apiKey: "key", model: "", baseUrl: "" };

// ─────────────────────── callText: диспетчеризация по провайдеру ───────────────────────

test("callText: provider=anthropic — идёт в Anthropic API", async () => {
  responses.push(jsonResponse(200, { content: [{ type: "text", text: "  привет  " }] }));
  const text = await callText(anthropicSettings, "sys", []);
  assert.equal(text, "привет"); // обрезаны пробелы
  assert.match(fetchCalls[0].url, /^https:\/\/api\.anthropic\.com/);
});

test("callText: provider=qwen — идёт в Qwen-совместимый endpoint", async () => {
  responses.push(jsonResponse(200, { choices: [{ message: { content: "ответ" } }] }));
  const text = await callText(qwenSettings, "sys", []);
  assert.equal(text, "ответ");
  assert.match(fetchCalls[0].url, /dashscope-intl\.aliyuncs\.com.*\/chat\/completions$/);
});

// ─────────────────────── Anthropic: парсинг ответа и ошибок ───────────────────────

test("callAnthropicText: берёт первый text-блок из content, остальные типы блоков игнорирует", async () => {
  responses.push(jsonResponse(200, { content: [{ type: "other" }, { type: "text", text: "нужный текст" }] }));
  assert.equal(await callText(anthropicSettings, "sys", []), "нужный текст");
});

test("callAnthropicText: !ok — бросает с кодом статуса и телом ответа", async () => {
  responses.push({ ok: false, status: 401, text: async () => "invalid api key" });
  await assert.rejects(() => callText(anthropicSettings, "sys", []), /Anthropic API 401.*invalid api key/s);
});

test("callAnthropicTool: возвращает input из tool_use блока", async () => {
  responses.push(jsonResponse(200, { content: [{ type: "text", text: "мысли вслух" }, { type: "tool_use", input: { score: 5 } }] }));
  const result = await callTool(anthropicSettings, "sys", "user text", { name: "submit" });
  assert.deepEqual(result, { score: 5 });
});

test("callAnthropicTool: ok, но модель не вызвала tool — понятная ошибка, а не undefined/крэш", async () => {
  responses.push(jsonResponse(200, { content: [{ type: "text", text: "просто текст без tool_use" }] }));
  await assert.rejects(() => callTool(anthropicSettings, "sys", "user text", { name: "submit" }), /не вернула структурированную оценку/);
});

test("callAnthropicTool: запрос содержит tool_choice, принудительно указывающий на нужный tool", async () => {
  responses.push(jsonResponse(200, { content: [{ type: "tool_use", input: {} }] }));
  await callTool(anthropicSettings, "sys", "user", { name: "my_tool" });
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "my_tool" });
});

// ─────────────────────── Qwen: парсинг, baseUrl, ретраи ───────────────────────

test("callQwenText: убирает завершающие слэши из baseUrl перед /chat/completions", async () => {
  responses.push(jsonResponse(200, { choices: [{ message: { content: "ok" } }] }));
  await callText({ ...qwenSettings, baseUrl: "https://example.com/v1///" }, "sys", []);
  assert.equal(fetchCalls[0].url, "https://example.com/v1/chat/completions");
});

test("callQwenText: !ok — бросает с кодом статуса и обрезанным (до 500 символов) телом", async () => {
  responses.push({ ok: false, status: 500, text: async () => "x".repeat(600) });
  await assert.rejects(() => callText(qwenSettings, "sys", []), /Qwen API 500/);
});

test("callQwenTool: happy path — парсит JSON из tool_calls[0].function.arguments", async () => {
  responses.push(jsonResponse(200, { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ ok: true }) } }] } }] }));
  const result = await callTool(qwenSettings, "sys", "user", { name: "submit" });
  assert.deepEqual(result, { ok: true });
});

test("callQwenTool: 429 — ретраит тот же запрос до успеха, не бросает", async () => {
  responses.push({ ok: false, status: 429, text: async () => "" });
  responses.push(jsonResponse(200, { choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] } }] }));
  const result = await callTool(qwenSettings, "sys", "user", { name: "submit" });
  assert.deepEqual(result, {});
  assert.equal(fetchCalls.length, 2);
});

test("callQwenTool: ошибка про «thinking mode» — на следующей попытке переключается на tool_choice:auto и дописывает системный промпт", async () => {
  responses.push({ ok: false, status: 400, text: async () => "Error: does not support tool_choice in thinking mode" });
  responses.push(jsonResponse(200, { choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] } }] }));
  await callTool(qwenSettings, "исходный system", "user", { name: "my_tool" });

  const secondBody = JSON.parse(fetchCalls[1].init.body);
  assert.equal(secondBody.tool_choice, "auto");
  assert.match(secondBody.messages[0].content, /ОБЯЗАТЕЛЬНО вызови функцию "my_tool"/);
  assert.match(secondBody.messages[0].content, /^исходный system/);
});

test("callQwenTool: модель не вызвала tool ни разу за все попытки — бросает последнюю ошибку, не зависает", async () => {
  for (let i = 0; i < 5; i++) responses.push(jsonResponse(200, { choices: [{ message: {} }] })); // без tool_calls
  await assert.rejects(() => callTool(qwenSettings, "sys", "user", { name: "submit" }), /не вызвала tool/);
  assert.equal(fetchCalls.length, 5);
});
