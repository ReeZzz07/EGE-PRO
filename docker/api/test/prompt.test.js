// Промпты ИИ-репетитора — конструируются заново на каждый запрос поверх редактируемого в админке
// policy-текста (см. комментарий в prompt.js). Главное, что должно оставаться неизменным при любых
// правках: заготовка подсказки нужного уровня передаётся модели, задание передаётся БЕЗ ответа, и
// явная инструкция "не называй финальный ответ" присутствует в каждом промпте, где есть задание —
// это единственная защита от прямой утечки ответа через сам системный промпт.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatPrompt,
  buildEssaySystemPrompt,
  buildExplainPrompt,
  buildHintPrompt,
  stripPerItemVerdicts,
  stripSequenceAnswer,
  stripAnswerDeclaration,
  stripFinalBareNumberFormula,
  stripAnswerLeak,
  findAnswerLeakIndex,
  hasModelGlitch,
  describeUnseenMedia,
  isMultiItemStatement,
  DEFAULT_POLICY,
} from "../prompt.js";

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

// Словесная просьба "не пересказывай заготовку" оказалась ненадёжной на практике: модель всё
// равно почти дословно повторяла вердикты из заготовки (см. живую проверку при разработке этого
// правила — подсказка 2-го уровня раскрыла вердикт сразу по двум пунктам, несмотря на инструкцию).
// Поэтому защита теперь механическая: заготовка с ≥2 пунктами вида "N) ... верно/неверно" вообще
// не попадает в текст промпта — модели физически нечего пересказывать.
test("buildHintPrompt: заготовка с вердиктами по ≥2 пунктам — САМ ТЕКСТ заготовки не попадает в промпт вообще", () => {
  const leakyScaffold = "1) Утверждение раз – верно, потому что... 2) Утверждение два – неверно, потому что...";
  const leakyTask = { ...task, hints: [task.hints[0], task.hints[1], leakyScaffold] };
  const prompt = buildHintPrompt("policy", leakyTask, 2);
  assert.doesNotMatch(prompt, /Утверждение раз/);
  assert.doesNotMatch(prompt, /Утверждение два/);
  assert.match(prompt, /не передаём/i);
  assert.match(prompt, /НЕ перечисляй вердикт по каждому суждению подряд/i);
});

test("buildHintPrompt: заготовка с вердиктом ровно по 1 пункту — не считается утечкой, передаётся как обычно", () => {
  const oneItemScaffold = "1) Утверждение раз – верно, потому что так устроена система.";
  const oneItemTask = { ...task, hints: [task.hints[0], task.hints[1], oneItemScaffold] };
  const prompt = buildHintPrompt("policy", oneItemTask, 2);
  assert.match(prompt, /Утверждение раз/);
});

test("DEFAULT_POLICY: запрещает построчный разбор верно/неверно для заданий «выберите верные суждения»", () => {
  assert.match(DEFAULT_POLICY, /выберите верные суждения/i);
  assert.match(DEFAULT_POLICY, /построчный разбор всего списка — это и есть финальный ответ/i);
});

test("buildHintPrompt: уровень зажимается сверху до последней (третьей) заготовки — не падает на выходе за границы", () => {
  assert.match(buildHintPrompt("policy", task, 5), /x - 1 = 2\^3/);
  assert.match(buildHintPrompt("policy", task, 99), /x - 1 = 2\^3/);
});

test("buildHintPrompt: содержит явный запрет называть финальный ответ и текст условия задания", () => {
  const prompt = buildHintPrompt("policy", task, 0);
  assert.match(prompt, /не произноси финальное число/i);
  assert.match(prompt, /Решите уравнение log2\(x-1\)=3/);
  assert.match(prompt, /тебе не передан правильный ответ этого задания/i);
});

test("buildHintPrompt: policy-текст из БД всегда идёт первым — редактируемая часть, не теряется", () => {
  assert.ok(buildHintPrompt("МОЙ КАСТОМНЫЙ ПРОМПТ", task, 0).startsWith("МОЙ КАСТОМНЫЙ ПРОМПТ"));
});

test("buildExplainPrompt: без задания — не падает и ничего не выдумывает про отсутствующее задание", () => {
  const prompt = buildExplainPrompt("policy", undefined);
  assert.match(prompt, /как решать это задание/i);
  assert.doesNotMatch(prompt, /Контекст задания/);
});

test("buildExplainPrompt: с заданием — подставляет реальную тему, требует разбирать САМО задание, запрещает называть финальный ответ и требует закончить вопросом", () => {
  const prompt = buildExplainPrompt("policy", task);
  assert.match(prompt, /«Логарифмические уравнения»/);
  assert.match(prompt, /Решите уравнение log2\(x-1\)=3/);
  assert.match(prompt, /реальные числа, слова, варианты и данные из условия/i);
  assert.match(prompt, /сформулируй именно ЕГО как явный вопрос ученику/i);
  assert.match(prompt, /не завершённой формулой с названным числом/i);
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

// ─────────────────────── stripPerItemVerdicts — механический фильтр ответа ───────────────────────
// Инструкция в DEFAULT_POLICY ("разбирать так подробно можно максимум ОДИН вариант") — первый
// рубеж, но словесная. Живая проверка (см. историю правок) показала: qwen-max её не всегда
// соблюдает — на задании "Ударения" (РУС · rus-36673, реальный текст ответа модели, записан как
// есть) модель дважды подряд явно разбирала задание по шагам, называя вердикт "верно"/"неверно" по
// каждому из 5 вариантов, хоть финальную строку цифр и не печатала. Это и есть ответ, россыпью.
test("stripPerItemVerdicts: реальный ответ модели на «Ударения» (5 пунктов, вердикт по каждому) — обрубается после первого пункта", () => {
  // Первый живой прогон (до расширения правила на любые форматы, не только «выберите суждения»).
  const liveResponse1 = `Конечно, давай разберем это задание по шагам. Твоя задача — выбрать варианты, в которых верно выделена буква, обозначающая ударный гласный звук.

1) **свЕрлит**
   - В этом слове ударение падает на второй слог: свЕрлит. Это правильное ударение.

2) **пОручни**
   - Здесь ударение должно быть на первый слог: поручни. Это тоже правильное ударение.

3) **углУбленный**
   - В этом слове ударение падает на третий слог: углубленный. Это правильное ударение.

4) **знАчимость**
   - Ударение в этом слове падает на второй слог: значимость. Это правильное ударение.

5) **закупОрив**
   - В этом слове ударение падает на третий слог: закупорив. Это правильное ударение.

Теперь запиши номера вариантов, где ударение выделено верно.`;

  const result = stripPerItemVerdicts(liveResponse1);
  assert.equal(result.trimmed, true);
  // Пункт 1 (разрешённая иллюстрация метода) — остаётся как есть.
  assert.match(result.text, /свЕрлит/);
  assert.match(result.text, /Это правильное ударение/);
  // Пункты 2–5 с вердиктом — вырезаны целиком, включая слово "поручни" из пункта 2.
  assert.doesNotMatch(result.text, /поручни/i);
  assert.doesNotMatch(result.text, /углубленный/i);
  assert.doesNotMatch(result.text, /значимость/i);
  assert.doesNotMatch(result.text, /закупорив/i);
  assert.match(result.text, /Остальные варианты разбери сам/i);
});

test("stripPerItemVerdicts: второй живой прогон (после расширения правила) — вердикт всё равно проскочил, фильтр всё равно обрубает", () => {
  // Второй живой прогон, уже после того, как DEFAULT_POLICY явно запретил вердикт по формулировкам
  // «укажите варианты, в которых...», а не только «выберите верные суждения» — модель всё равно не
  // удержалась (см. итог обсуждения: словесный запрет — не гарантия, поэтому и нужен этот фильтр).
  const liveResponse2 = `Конечно, давай разберем это задание по шагам.

1. **свЕрлит**
   - Как ты думаешь, на какой слог падает ударение? Правильно, ударение падает на первый слог: "свЕрлит".

2. **пОручни**
   - В слове "поручни" ударение обычно падает на второй слог: "поРучни".
   - Здесь ударение выделено на первый слог, что неверно.

3. **углУбленный**
   - Здесь ударение выделено на второй слог, что неверно.

4. **знАчимость**
   - Здесь ударение выделено на первый слог, что неверно.

5. **закупОрив**
   - Здесь ударение выделено верно.

Составь список верных вариантов и запиши их номера.`;

  const result = stripPerItemVerdicts(liveResponse2);
  assert.equal(result.trimmed, true);
  assert.match(result.text, /свЕрлит/);
  assert.doesNotMatch(result.text, /поручни/i);
  assert.doesNotMatch(result.text, /закупорив/i);
  assert.match(result.text, /Остальные варианты разбери сам/i);
});

test("stripPerItemVerdicts: разбор ОДНОГО варианта как иллюстрация (разрешено политикой) — не трогает текст", () => {
  const oneItemOnly = `Тема — «Ударения». Разберём один вариант как пример:

1) **закупОрив**
   - Ударение падает на третий слог, это правильное ударение.

Остальные варианты проверь сам(а) по тому же принципу.`;

  const result = stripPerItemVerdicts(oneItemOnly);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, oneItemOnly);
});

test("stripPerItemVerdicts: буквенная нумерация (задание на соответствие, А/Б/В/Г/Д) — тоже ловится", () => {
  // Реальная форма задания ОБЩ (см. отчёт проверки): "А) Производственный кооператив... Б) ГУП..."
  const matchingTaskLeak = `Разберём соответствие по каждой позиции:

А) Производственный кооператив «Максим» — это подходит под «Предприятие», значит соответствует позиции 2.

Б) ГУП «Мосэлектротранс» — государственное унитарное предприятие, значит соответствует позиции 1.

В) Министерство экономического развития РФ — государственный орган, соответствует позиции 1.`;

  const result = stripPerItemVerdicts(matchingTaskLeak);
  assert.equal(result.trimmed, true);
  assert.match(result.text, /Производственный кооператив/);
  assert.doesNotMatch(result.text, /ГУП/);
  assert.doesNotMatch(result.text, /Министерство/);
});

test("stripPerItemVerdicts: обычная прозаическая подсказка без нумерованного списка — не трогает текст", () => {
  const plainHint = "Вспомни правило: в причастиях на -ованный/-ёванный ударение обычно падает на суффикс. Попробуй применить это к словам из условия.";
  const result = stripPerItemVerdicts(plainHint);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, plainHint);
});

// ─────────────────────── stripSequenceAnswer — вторая утечка (готовая цепочка цифр) ───────────────────────
// Реальный ответ модели на bio-75896 ("Установите последовательность расположения нервных центров...",
// живой прогон при проверке фикса усечения по max_tokens) — построчного вердикта тут нет вообще
// (stripPerItemVerdicts его пропускает), но в конце модель прямо продиктовала готовую
// последовательность цифр для бланка ответа. Текст записан как есть, без изменений.
test("stripSequenceAnswer: реальный ответ модели на bio-75896 — дефис-цепочка «1-4-3-5-2-6» — обрубается с начала этого предложения", () => {
  const liveResponse = `Конечно, давай разберем это задание по шагам. Нам нужно установить последовательность расположения нервных центров в организме человека в порядке их приближения к коре больших полушарий.

Теперь, давай расположим их в правильном порядке:

1. Ядра симпатической нервной системы, регулирующие работу сердца
2. Ядра парасимпатической нервной системы, регулирующие мочевыделение
3. Слюноотделительный центр
4. Центр эндокринной регуляции
5. Центр ориентировочных рефлексов на зрительный стимул
6. Речевой центр Брока

Таким образом, последовательность должна быть следующей: 1-4-3-5-2-6. Теперь, когда у нас есть эта последовательность, осталось только записать соответствующие цифры в том порядке, как они указаны в условии.

Последний шаг — запишите эту последовательность цифр в ответ. Вы готовы сделать это?`;

  const result = stripSequenceAnswer(liveResponse);
  assert.equal(result.trimmed, true);
  // Разбор по пунктам (метод) остаётся — это не вердикт, это перечисление структур из учебника.
  assert.match(result.text, /Слюноотделительный центр/);
  // Само предложение с готовой цепочкой цифр и всё, что после него, вырезано целиком.
  assert.doesNotMatch(result.text, /1-4-3-5-2-6/);
  assert.doesNotMatch(result.text, /следующей/);
  assert.doesNotMatch(result.text, /Вы готовы сделать это/);
  assert.match(result.text, /Саму последовательность запиши сам/i);
});

test("stripSequenceAnswer: список через запятую после двоеточия («в порядке: 3, 1, 4, 2») — тоже ловится", () => {
  const withCommaList = `Разберём по шагам, где какое событие.

Теперь, когда мы знаем даты, распределим события в порядке: 3, 1, 4, 2. Это и есть искомая последовательность.`;
  const result = stripSequenceAnswer(withCommaList);
  assert.equal(result.trimmed, true);
  assert.doesNotMatch(result.text, /3, 1, 4, 2/);
});

test("stripSequenceAnswer: даты (например, «1941-1945») не считаются утечкой последовательности", () => {
  const withDateRange = "Великая Отечественная война длилась с 1941-1945 год. Это важный период истории.";
  const result = stripSequenceAnswer(withDateRange);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, withDateRange);
});

test("stripSequenceAnswer: обычный текст без цепочки цифр — не трогает текст", () => {
  const plain = "Подумай, какое событие произошло раньше — сравни века, в которых они случились.";
  const result = stripSequenceAnswer(plain);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, plain);
});

// ─────────────────────── stripAnswerDeclaration — третья, ЧАСТИЧНАЯ утечка ───────────────────────
// Живой пример на задании "Найдите cos(x)..." (математика, ЕГЭ №11) — модель довела вычисление до
// конца и прямо провозгласила результат финальным ответом, несмотря на прямой запрет в промпте.
test("stripAnswerDeclaration: реальный ответ модели про cos(x) — явное «это и есть ответ» обрубается", () => {
  const liveResponse = `Шаг 5: Определим знак cos(x)

Поскольку x находится во второй четверти, cos(x) должен быть отрицательным. Поэтому:

\\[
\\cos(x) = -0,6
\\]

Заключение

Мы нашли, что cos(x) = -0,6. Это и есть ответ на задание!`;

  const result = stripAnswerDeclaration(liveResponse);
  assert.equal(result.trimmed, true);
  assert.doesNotMatch(result.text, /Это и есть ответ/i);
  assert.match(result.text, /Последний шаг — твой/i);
});

// Известное и задокументированное ограничение (см. комментарий у stripAnswerDeclaration в
// prompt.js): без явной фразы-декларации ("это ответ") фильтр НЕ ловит утечку — реальный пример на
// физике (fiz-25069, модуль перемещения), где модель сама вычислила и назвала итоговое число, но не
// подтвердила его словом "ответ". Тест фиксирует это ограничение, а не проверяет его исправление.
test("stripAnswerDeclaration: известное ограничение — завершение без слова «ответ» не ловится", () => {
  const liveResponsePhysics = `Таким образом, последним действием нужно взять абсолютное значение полученного перемещения. В данном случае, оно уже равно нулю, поэтому модуль тоже равен нулю.

Если у тебя есть вопросы по какому-то из шагов или ты хочешь проверить свои расчеты, дай знать!`;
  const result = stripAnswerDeclaration(liveResponsePhysics);
  assert.equal(result.trimmed, false);
});

test("stripAnswerDeclaration: обычные упоминания слова «ответ» (вопрос, инструкция) — не трогает текст", () => {
  const plain = "Теперь запиши ответ на бланке. Какой ответ ты получишь, если подставишь эти числа?";
  const result = stripAnswerDeclaration(plain);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, plain);
});

// ─────────────────── stripFinalBareNumberFormula — утечка БЕЗ слова "ответ" ───────────────────
// Живой пример на задании про куб (math-31517, "Найдите диагональ куба, если его объём равен...")
// после усиления формулировки промпта (требование заканчивать вопросом) — модель всё равно довела
// последнюю формулу до голого числа, а вопрос после неё стал бессмысленным (ответ уже назван).
test("stripFinalBareNumberFormula: реальный ответ модели про куб — последняя формула сведена до голого числа, обрубается", () => {
  const liveResponse = `### Шаг 4: Упростим выражение
Упростим выражение:
\\[ d = 4\\sqrt{3} \\times \\sqrt{3} \\]
\\[ d = 4 \\times 3 \\]
\\[ d = 12 \\]

### Итоговый вопрос
Теперь осталось выполнить последнее действие. Какой результат получится, если вычислить это выражение?`;

  const result = stripFinalBareNumberFormula(liveResponse);
  assert.equal(result.trimmed, true);
  // Предпоследняя формула (ход решения) остаётся — вырезана только последняя, "= 12", и всё после.
  assert.match(result.text, /d = 4\\sqrt\{3\} \\times \\sqrt\{3\}/);
  assert.doesNotMatch(result.text, /= 12/);
  assert.doesNotMatch(result.text, /Итоговый вопрос/);
  assert.match(result.text, /вычисли сам/i);
});

// Живой пример БЕЗ утечки на том же типе задания (math-31519, "Найдите диагональ куба, если площадь
// его поверхности равна 450") — модель честно остановилась перед последним умножением, оставив
// правую часть невыполненной. Фильтр не должен резать легитимный ответ, где всё сделано правильно.
test("stripFinalBareNumberFormula: хороший случай (последняя формула НЕ доведена до числа) — не трогает текст", () => {
  const liveGoodResponse = `Подставим найденное значение \\( a \\):
\\[ d = (5\\sqrt{3})\\sqrt{3} \\]

Теперь осталось выполнить последнее действие. Какой результат получится, если вычислить это выражение?`;

  const result = stripFinalBareNumberFormula(liveGoodResponse);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, liveGoodResponse);
});

// Живой пример БЕЗ утечки на физике (fiz-25069) — последняя формула оставляет модуль невычисленным
// ("|0|", а не голое "0"), поэтому это НЕ совпадает с "голым числом" и не режется.
test("stripFinalBareNumberFormula: модуль/корень/выражение в правой части (не голое число) — не трогает текст", () => {
  const liveGoodResponse = `### Шаг 4: Определим модуль перемещения

Модуль перемещения — это абсолютное значение перемещения:

\\[ |\\Delta x| = |0| \\]

Какое значение получится, если вычислить это выражение?`;

  const result = stripFinalBareNumberFormula(liveGoodResponse);
  assert.equal(result.trimmed, false);
});

test("stripFinalBareNumberFormula: промежуточная формула вида «X = число», но НЕ последняя в тексте — не трогает текст", () => {
  const withIntermediateStep = `\\[ a^2 = 75 \\]

Теперь найдём \\( a \\):
\\[ a = \\sqrt{75} \\]

Что получится, если вычислить корень?`;

  const result = stripFinalBareNumberFormula(withIntermediateStep);
  assert.equal(result.trimmed, false);
  assert.equal(result.text, withIntermediateStep);
});


// ─────────────── сверка с эталонным ответом из БД, сбои модели, заготовки, достоверность ───────────────
// Все примеры — живые ответы прод-репетитора из аудита 24.09.2026 (см. память проекта).

const MC = ["Выберите три верных ответа из шести.", "1) дно ротовой полости", "2) участвует в выведении половых продуктов", "3) обеспечивает удаление мочи", "4) дыхательный клапан", "5) усиливает звук", "6) расширение задней кишки"];

test("findAnswerLeakIndex: код выбора, названный россыпью («2, 3 и 6») или слитно, — утечка (bio-13948)", () => {
  assert.notEqual(findAnswerLeakIndex("Итак, верные варианты — 2, 3 и 6.", "236", MC), -1);
  assert.notEqual(findAnswerLeakIndex("Ответ: 236", "236", MC), -1);
  assert.equal(findAnswerLeakIndex("Разберём пункты 1 и 4, они неверные.", "236", MC), -1);
});

test("findAnswerLeakIndex: число — по границам слова: 704 не находится в 7040 и в 1704", () => {
  assert.notEqual(findAnswerLeakIndex("Значит, расстояние 704 км.", "704", ["Сколько километров?"]), -1);
  assert.equal(findAnswerLeakIndex("Получилось 7040 и 1704", "704", ["Сколько километров?"]), -1);
});

test("findAnswerLeakIndex: десятичная запятая и точка эквивалентны; отрицательное отличается от положительного", () => {
  assert.notEqual(findAnswerLeakIndex("Итого 0.35", "0,35", ["Найдите вероятность"]), -1);
  assert.equal(findAnswerLeakIndex("Итого -2,7", "2,7", ["Найдите значение"]), -1);
  assert.notEqual(findAnswerLeakIndex("Итого -2,7", "-2,7", ["Найдите значение"]), -1);
});

test("findAnswerLeakIndex: 1–2-значные числа не сверяются (слишком часты в вычислениях)", () => {
  assert.equal(findAnswerLeakIndex("Получаем 24 и ещё 3", "24", ["Найдите площадь"]), -1);
  assert.equal(findAnswerLeakIndex("Получаем 1", "1", ["Найдите время"]), -1);
});

test("findAnswerLeakIndex: слово-ответ в любой форме и любой вариант через «/» (lit-7623, bio-49157)", () => {
  assert.notEqual(findAnswerLeakIndex("Этот приём называется олицетворением.", "олицетворение", ["Укажите приём"]), -1);
  assert.notEqual(findAnswerLeakIndex("Это часть обмена веществ.", "обмен веществ/обменвеществ/метаболизм", ["Впишите термин"]), -1);
  assert.notEqual(findAnswerLeakIndex("Речь о метаболизме клетки.", "обмен веществ/метаболизм", ["Впишите термин"]), -1);
});

test("findAnswerLeakIndex: то, что уже есть в условии, утечкой не считается", () => {
  assert.equal(findAnswerLeakIndex("Ты говоришь о 704 км", "704", ["Теплоход прошёл 704 км?"]), -1);
  assert.equal(findAnswerLeakIndex("Речь про Иркутск", "Иркутск", ["Найдите город Иркутск на схеме"]), -1);
});

test("stripAnswerLeak: обрубает с начала абзаца с ответом и приглашает доделать самому", () => {
  const text = "Шаг 1. Считаем скорости.\n\nШаг 2. Подставляем: S = 704 км.\n\nВот и всё.";
  const r = stripAnswerLeak(text, "704", ["Сколько километров?"]);
  assert.equal(r.trimmed, true);
  assert.match(r.text, /^Шаг 1\. Считаем скорости\./);
  assert.doesNotMatch(r.text, /704/);
  assert.match(r.text, /Дальше — твой ход/);
});

test("stripAnswerLeak: ответ уже в первом абзаце — вместо пустого текста короткое объяснение", () => {
  const r = stripAnswerLeak("Ответ 704 км.", "704", ["Сколько километров?"]);
  assert.equal(r.trimmed, true);
  assert.doesNotMatch(r.text, /704/);
  assert.match(r.text, /слишком близко/);
});

test("stripAnswerLeak: утечки нет или эталона нет — текст не меняется", () => {
  const text = "Найди скорости по течению и против него.";
  assert.deepEqual(stripAnswerLeak(text, "704", ["x"]), { text, trimmed: false });
  assert.deepEqual(stripAnswerLeak(text, null, ["x"]), { text, trimmed: false });
});

test("hasModelGlitch: иероглифы и служебные токены модели — сбой; обычный русский/английский текст — нет", () => {
  assert.equal(hasModelGlitch("Подумай, как 电解水溶液 связан с ионами"), true);
  assert.equal(hasModelGlitch("...текст\n<|im_start|>assistant\nТема задания"), true);
  assert.equal(hasModelGlitch("Тема: electrolysis (электролиз), формула CuCl₂ → Cu + Cl₂"), false);
});

test("isMultiItemStatement: список пунктов — да, обычная задача — нет", () => {
  assert.equal(isMultiItemStatement(MC), true);
  assert.equal(isMultiItemStatement(["Решите уравнение log2(x-1)=3"]), false);
  assert.equal(isMultiItemStatement(["А) Рижский | 1) A", "Б) Финский | 2) B", "В) Ботнический | 3) C"]), true);
});

test("buildHintPrompt: многопунктное задание на уровнях 2–3 — заготовка не передаётся, на уровне 1 передаётся", () => {
  const t = { topic: "Земноводные", egeNumber: 11, statement: MC, hints: ["Вспомни функции клоаки.", "Верные — 2, 3, 6 потому что…", "Ответ: 236"] };
  const l1 = buildHintPrompt("policy", t, 0);
  const l2 = buildHintPrompt("policy", t, 1);
  const l3 = buildHintPrompt("policy", t, 2);
  assert.match(l1, /Вспомни функции клоаки/);
  assert.doesNotMatch(l2, /Верные — 2, 3, 6/);
  assert.doesNotMatch(l3, /Ответ: 236/);
  assert.match(l3, /содержит готовый разбор или ответ/);
});

test("buildHintPrompt: заготовка с эталонным ответом внутри не попадает в промпт, даже если это не список", () => {
  const t = { topic: "Лексика", egeNumber: 35, statement: ["Вставьте слово в пропуск."], hints: ["Подумай о значении.", "Смотри на контекст.", "Подходит слово involves — включает в себя."] };
  const withAnswer = buildHintPrompt("policy", t, 2, { answer: "involves" });
  assert.doesNotMatch(withAnswer, /involves/);
  assert.match(withAnswer, /не передаём/i);
  const withoutAnswer = buildHintPrompt("policy", t, 2, {});
  assert.match(withoutAnswer, /involves/);
});

test("промпты с заданием содержат правила достоверности: не выдумывать отсутствующий текст/картинки, не уводить от верного, только по-русски", () => {
  for (const prompt of [buildHintPrompt("policy", task, 0), buildExplainPrompt("policy", task), buildChatPrompt("policy", task)]) {
    assert.match(prompt, /ПРАВИЛА ДОСТОВЕРНОСТИ/);
    assert.match(prompt, /НЕ придумывай его содержание/);
    assert.match(prompt, /не объявляй правильное рассуждение/);
    assert.match(prompt, /только по-русски/);
  }
});

test("промпты: приложенное, чего модель не видит (график без vision, аудио), называется явно", () => {
  const ctx = { unseenMedia: describeUnseenMedia({ media: [{ storage_path: "a/g.png" }, { storage_path: "a/rec.mp3" }] }, false) };
  const prompt = buildExplainPrompt("policy", task, ctx);
  assert.match(prompt, /НЕ видишь/);
  assert.match(prompt, /аудиозапись/);
  assert.match(prompt, /рисунок, график, схема или карта/);
  assert.doesNotMatch(buildExplainPrompt("policy", task, {}), /НЕ видишь/);
});

test("describeUnseenMedia: формулы (.svg) не считаются «невидимыми»; с vision картинки видны, аудио — нет", () => {
  assert.deepEqual(describeUnseenMedia({ media: [{ storage_path: "a/f.svg" }] }, false), []);
  assert.deepEqual(describeUnseenMedia({ media: [{ storage_path: "a/g.png" }] }, true), []);
  assert.equal(describeUnseenMedia({ media: [{ storage_path: "a/rec.mp3" }] }, true).length, 1);
  assert.deepEqual(describeUnseenMedia(undefined, false), []);
});

// Живые ответы аудита 24.09.2026: вердикт по каждому пункту БЕЗ слов «верно/подходит» — обычный фильтр их
// пропускал, «широкий» (для заданий с выбором/сопоставлением пунктов) обрубает после первого вердикта.
test("stripPerItemVerdicts(broad): bio-13948 — «действительно участвует», «не является», «Да, клоака…» по каждому пункту", () => {
  const live = `Давай посмотрим на каждый пункт:

1) **Дно ротовой полости** — Клоака не связана с ротовой полостью.

2) **Участвует в выведении половых продуктов** — Клоака действительно участвует в выведении половых продуктов.

3) **Обеспечивает удаление мочи** — Да, клоака у амфибий также служит для удаления мочи.

4) **Дыхательный клапан** — Клоака не является дыхательным клапаном.`;
  assert.equal(stripPerItemVerdicts(live).trimmed, false); // обычный режим этих слов не знает
  const r = stripPerItemVerdicts(live, { broad: true });
  assert.equal(r.trimmed, true);
  assert.match(r.text, /1\) \*\*Дно ротовой полости/);
  assert.doesNotMatch(r.text, /Обеспечивает удаление мочи/);
  assert.doesNotMatch(r.text, /Дыхательный клапан/);
});

test("stripPerItemVerdicts(broad): hist-39183 — «### Шаг N» с «точно относится» — обрубается после первого шага", () => {
  const live = `Установим соответствие.

### Шаг 1: Внешняя политика Василия I
- **Факт 5**: Установление династических отношений. Он действительно устанавливал династические связи.

### Шаг 2: Крымская война
- **Факт 1**: Гибель Истомина. Этот факт точно относится к Крымской войне.

### Шаг 3: Внешняя политика Ивана IV
- **Факт 4**: Завоевание Казанского ханства.`;
  const r = stripPerItemVerdicts(live, { broad: true });
  assert.equal(r.trimmed, true);
  assert.match(r.text, /Шаг 1/);
  assert.doesNotMatch(r.text, /Гибель Истомина/);
});

test("stripPerItemVerdicts(broad): обычные шаги решения без вердиктов по пунктам — не трогает", () => {
  const plain = `### Шаг 1: Понимаем условие
Нужно найти площадь.

### Шаг 2: Вспоминаем формулу
S = a·h.

### Шаг 3: Подставляем
Что получится?`;
  assert.equal(stripPerItemVerdicts(plain, { broad: true }).trimmed, false);
});
