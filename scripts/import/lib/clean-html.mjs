// Чистит сырой HTML из output/<subject>/tasks.jsonl (экспорт FIPI/MS Word) до читаемого текста
// для промпта LLM. Не претендует на идеальную вёрстку — важна смысловая точность,
// финальный рендер для учеников будет отдельным шагом (после того как банк пройдёт проверку).
import * as cheerio from "cheerio";

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Линеаризует таблицу (часто используется в matching/sequence заданиях) построчно, ячейки через " | ". */
function tableToText($, el) {
  const rows = [];
  $(el)
    .find("tr")
    .each((_, tr) => {
      const cells = [];
      $(tr)
        .find("> td, > th")
        .each((_, td) => {
          const t = $(td).text().replace(/\s+/g, " ").trim();
          if (t) cells.push(t);
        });
      if (cells.length) rows.push(cells.join(" | "));
    });
  return rows.join("\n");
}

/** Чистит html одного варианта ответа (поле `variants[].html`) до простого текста. */
function cleanVariantHtml(html) {
  const $ = cheerio.load(`<root>${html ?? ""}</root>`, { xmlMode: false });
  const root = $("root");
  root.find("br").replaceWith(" ");
  let text = decodeEntities(root.text());
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Рендерит структурированное поле `variants` (появилось в новой выгрузке — надёжнее,
 * чем разбор вложенных Word-таблиц из body_html) в читаемый список для промпта.
 * Буквенные label (А, Б, В…) и цифровые (1, 2, 3…) — типичное разделение на «вопрос/ответ»
 * в заданиях на соответствие, поэтому выводим их отдельными группами, если оба вида присутствуют.
 */
function renderVariants(variants) {
  if (!variants || variants.length === 0) return "";
  const isLetter = (label) => /^[А-Яа-яA-Za-z]+$/.test(label ?? "");
  const letters = variants.filter((v) => isLetter(v.label));
  const numbers = variants.filter((v) => !isLetter(v.label));

  const renderGroup = (items) => items.map((v) => `${v.label}) ${cleanVariantHtml(v.html)}`).join("\n");

  if (letters.length > 0 && numbers.length > 0) {
    return `\n\nВАРИАНТЫ (левый столбец):\n${renderGroup(letters)}\n\nВАРИАНТЫ (правый столбец / на выбор):\n${renderGroup(numbers)}`;
  }
  return `\n\nВАРИАНТЫ ОТВЕТА:\n${renderGroup(variants)}`;
}

/**
 * @param {string} html
 * @param {Array} [variants] — поле `variants` из задания (новая выгрузка), опционально
 * @returns {{ text: string, imagesInOrder: string[], hasOptions: boolean }} — очищенный текст,
 *   список src картинок в порядке появления, и флаг «нашли ли вообще откуда взять варианты
 *   ответа» (для choice/matching/sequence типов — если false, задание физически нерешаемо).
 */
export function cleanTaskHtml(html, variants) {
  const $ = cheerio.load(`<root>${html}</root>`, { xmlMode: false });
  const root = $("root");
  const imagesInOrder = [];

  root.find("img").each((_, img) => {
    const src = $(img).attr("src");
    if (src) imagesInOrder.push(src);
    $(img).replaceWith(imagesInOrder.length ? ` [ИЗОБРАЖЕНИЕ ${imagesInOrder.length}] ` : " [ИЗОБРАЖЕНИЕ] ");
  });

  const hasVariants = Array.isArray(variants) && variants.length > 0;
  let sawBodyTable = false;

  // верхнеуровневые таблицы линеаризуем сами (пока не всплыли во вложенные), затем убираем как обработанные.
  // Если структурированные `variants` уже есть — не дублируем их текстом из body_html-таблицы.
  root.find("table").each((_, table) => {
    if ($(table).parents("table").length > 0) return; // вложенные обработаются вместе с родителем
    if (hasVariants) {
      $(table).remove();
      return;
    }
    sawBodyTable = true;
    const asText = tableToText($, table);
    $(table).replaceWith(`\n${asText}\n`);
  });

  root.find("br").replaceWith("\n");
  root.find("p, div, tr").each((_, el) => {
    $(el).append("\n");
  });

  let text = root.text();
  text = decodeEntities(text);
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (arr[i - 1] && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (hasVariants) text += renderVariants(variants);

  return { text, imagesInOrder, hasOptions: hasVariants || sawBodyTable };
}

/** Типы заданий, для которых обязательно нужен список вариантов/сопоставлений — иначе решать нечего. */
export const OPTION_DEPENDENT_TYPES = new Set([
  "Выбор ответов из предложенных вариантов",
  "select_one",
  "matching",
  "Последовательность",
  "Расстановка терминов",
  "Распределение",
]);
