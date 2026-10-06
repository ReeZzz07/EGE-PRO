// Приведение формул ответа ИИ-репетитора к скобочной разметке (docker/api/mathFormat.js): интерфейс и серверные
// фильтры утечки понимают только её, а модель временами пишет формулы со знаком доллара.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATH_FORMAT_RULE, normalizeMath } from "../mathFormat.js";
import { stripFinalBareNumberFormula } from "../prompt.js";

const BS = String.fromCharCode(92);

test("инлайн $...$ → \\(...\\), блочная $$...$$ → \\[...\\]", () => {
  assert.equal(normalizeMath("Дана функция $f(x) = 3$ и всё."), `Дана функция ${BS}(f(x) = 3${BS}) и всё.`);
  assert.equal(normalizeMath("Итого:\n$$\nd = 1\n$$\nДальше."), `Итого:\n${BS}[d = 1${BS}]\nДальше.`);
  assert.equal(normalizeMath(`$${BS}frac{4 + (-2)}{2} = 1$`), `${BS}(${BS}frac{4 + (-2)}{2} = 1${BS})`);
});

test("обычные доллары (цены, одиночный знак, пробелы у границ) формулой не считаются; готовая скобочная разметка не меняется", () => {
  const plain = "Билет стоил 5 $ и ещё 6 $ сверху. Просто знак $ в конце";
  assert.equal(normalizeMath(plain), plain);
  const already = `Уже ${BS}(x + 1${BS}) и ${BS}[y = 2${BS}]`;
  assert.equal(normalizeMath(already), already);
  assert.equal(normalizeMath(""), "");
  assert.equal(normalizeMath(null), "");
});

test("после нормализации фильтр «последняя формула — голое число» снова видит ответ в долларовой разметке", () => {
  const raw = "Считаем: $d = 4 \\cdot 3$, значит $d = 12$";
  assert.equal(stripFinalBareNumberFormula(raw).trimmed, false, "до нормализации фильтр слеп");
  const cut = stripFinalBareNumberFormula(normalizeMath(raw));
  assert.equal(cut.trimmed, true);
  assert.ok(!cut.text.includes("12"));
});

test("правило для промпта: просит скобочную разметку и запрещает доллары", () => {
  assert.ok(MATH_FORMAT_RULE.includes(`${BS}( ... ${BS})`));
  assert.ok(MATH_FORMAT_RULE.includes(`${BS}[ ... ${BS}]`));
  assert.match(MATH_FORMAT_RULE, /не используй/);
});
