// Промпты ИИ-репетитора — конструируются заново на каждый запрос поверх редактируемого в админке
// policy-текста (см. комментарий в prompt.js). Главное, что должно оставаться неизменным при любых
// правках: заготовка подсказки нужного уровня передаётся модели, задание передаётся БЕЗ ответа, и
// явная инструкция "не называй финальный ответ" присутствует в каждом промпте, где есть задание —
// это единственная защита от прямой утечки ответа через сам системный промпт.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatPrompt, buildEssaySystemPrompt, buildExplainPrompt, buildHintPrompt, DEFAULT_POLICY } from "../prompt.js";

const task = {
  topic: "Логарифмические уравнения",
  egeNumber: 5,
  statement: ["Решите уравнение log2(x-1)=3"],
  hints: ["Подумай про область определения.", "Приведи к одному основанию.", "x - 1 = 2^3, реши линейное уравнение."],
};

test("buildHintPrompt: без задания — просит уточнить, к чему нужна подсказка, не выдумывает контекст", () => {
  const prompt = buildHintPrompt("policy", undefined, 0);
  assert.match(prompt, /уточни, к какому заданию/i);
});

test("buildHintPrompt: подставляет заготовку нужного уровня (0-indexed)", () => {
  assert.match(buildHintPrompt("policy", task, 0), /Подумай про область определения/);
  assert.match(buildHintPrompt("policy", task, 1), /Приведи к одному основанию/);
  assert.match(buildHintPrompt("policy", task, 2), /x - 1 = 2\^3/);
});

test("buildHintPrompt: уровень зажимается сверху до последней (третьей) заготовки — не падает на выходе за границы", () => {
  assert.match(buildHintPrompt("policy", task, 5), /x - 1 = 2\^3/);
  assert.match(buildHintPrompt("policy", task, 99), /x - 1 = 2\^3/);
});

test("buildHintPrompt: содержит явный запрет называть финальный ответ и текст условия задания", () => {
  const prompt = buildHintPrompt("policy", task, 0);
  assert.match(prompt, /не называй финальный ответ/i);
  assert.match(prompt, /Решите уравнение log2\(x-1\)=3/);
  assert.match(prompt, /ответ этого задания тебе намеренно не передан/i);
});

test("buildHintPrompt: policy-текст из БД всегда идёт первым — редактируемая часть, не теряется", () => {
  assert.ok(buildHintPrompt("МОЙ КАСТОМНЫЙ ПРОМПТ", task, 0).startsWith("МОЙ КАСТОМНЫЙ ПРОМПТ"));
});

test("buildExplainPrompt: без задания — «тема не указана», не падает и не выдумывает тему", () => {
  assert.match(buildExplainPrompt("policy", undefined), /тему «не указана»/i);
});

test("buildExplainPrompt: с заданием — подставляет реальную тему и просит не решать текущее задание", () => {
  const prompt = buildExplainPrompt("policy", task);
  assert.match(prompt, /«Логарифмические уравнения»/);
  assert.match(prompt, /не решай текущее задание/i);
});

test("buildChatPrompt: включает контекст задания, когда оно есть", () => {
  assert.match(buildChatPrompt("policy", task), /Контекст задания/);
});

test("buildChatPrompt: без задания — просто policy + инструкция отвечать по существу, без блока контекста", () => {
  const prompt = buildChatPrompt("policy", undefined);
  assert.doesNotMatch(prompt, /Контекст задания/);
  assert.match(prompt, /Отвечай на вопрос ученика по существу/i);
});

test("buildEssaySystemPrompt: включает policy целиком и переключает роль на оценщика по критериям", () => {
  const prompt = buildEssaySystemPrompt("МОЙ ПРОМПТ");
  assert.match(prompt, /^МОЙ ПРОМПТ/);
  assert.match(prompt, /модель-оценщик/i);
  assert.match(prompt, /submit_assessment/);
});

test("DEFAULT_POLICY: содержит ключевые правила безопасности (не решать за ученика, не называть ответ)", () => {
  assert.match(DEFAULT_POLICY, /СТРОГО ЗАПРЕЩЕНО/);
  assert.match(DEFAULT_POLICY, /называть финальный числовой/);
});
