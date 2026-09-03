// SAFE_TASKS — маленький статический курированный банк, который реально попадает в промпт ИИ
// (см. комментарий в safeTasks.js: "безопасное подмножество без answers/explanation"). Главный
// инвариант, который стоит проверять при любой правке этого файла: правильные ответы (TASK_ANSWERS)
// физически хранятся ОТДЕЛЬНО от объектов заданий и никогда не попадают в SAFE_TASKS — иначе они
// утекут прямо в системный промпт модели.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAFE_TASKS, TASK_ANSWERS, safeTaskById } from "../safeTasks.js";

test("safeTaskById: находит существующее задание по id", () => {
  const task = safeTaskById("m1");
  assert.equal(task?.topic, "Текстовые задачи на покупки");
});

test("safeTaskById: несуществующий id — undefined, не исключение", () => {
  assert.equal(safeTaskById("no-such-id"), undefined);
});

test("ни одно задание в SAFE_TASKS не содержит поле answer — ответы хранятся только в TASK_ANSWERS", () => {
  for (const t of SAFE_TASKS) {
    assert.equal("answer" in t, false, `задание ${t.id} содержит answer — утечёт в промпт`);
    assert.equal("explanation" in t, false, `задание ${t.id} содержит explanation — утечёт в промпт`);
  }
});

test("каждое автопроверяемое (не essay) задание имеет соответствующий ответ в TASK_ANSWERS", () => {
  for (const t of SAFE_TASKS) {
    if (t.answerType === "essay") continue;
    assert.ok(Array.isArray(TASK_ANSWERS[t.id]) && TASK_ANSWERS[t.id].length > 0, `нет TASK_ANSWERS для ${t.id}`);
  }
});

test("essay-задания несут критерии оценивания и минимальный объём вместо TASK_ANSWERS", () => {
  const essays = SAFE_TASKS.filter((t) => t.answerType === "essay");
  assert.ok(essays.length > 0);
  for (const t of essays) {
    assert.ok(Array.isArray(t.criteria) && t.criteria.length > 0, `нет критериев у ${t.id}`);
    assert.equal(typeof t.minWords, "number");
    assert.equal(t.id in TASK_ANSWERS, false, `essay-заданию ${t.id} не нужен TASK_ANSWERS`);
  }
});

test("у каждого задания три уровня подсказок (кроме случаев без hints вовсе)", () => {
  for (const t of SAFE_TASKS) {
    assert.equal(t.hints.length, 3, `у ${t.id} не три подсказки`);
  }
});

test("id заданий уникальны", () => {
  const ids = SAFE_TASKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
