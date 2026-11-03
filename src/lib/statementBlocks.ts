// Условия заданий приходят из импорта построчно (см. dbTasks.ts → toEgeTask), а таблицы из исходного HTML
// превращены в строки вида «Калий, мг | 238 | 240 | 520 | 190» — по одной строке на ряд таблицы. Чтобы их можно
// было показать таблицей, подряд идущие строки с « | » собираем обратно в блок-таблицу.
//
// Отдельно: задания на соответствие часто приходят ОДНОЙ строкой
// «СХЕМА… А) … Б) … | ИЗМЕНЕНИЕ… 1) … 2) …» — маркеры схлопнуты в абзац. Разворачиваем в списки / две колонки.

export interface TableCell {
  text: string;
  /** сколько колонок занимает ячейка (у строк-заголовков короче остальных последняя ячейка растягивается) */
  colSpan: number;
  header: boolean;
}

export interface ListColumn {
  title: string;
  items: string[];
}

export type StatementBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; rows: TableCell[][] }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "match"; left: ListColumn; right: ListColumn };

const SEP = " | ";

/** Маркер пункта: А) / Б) / 1) / 2. — не путать с формулами вроде O2 или «+1 →». */
const ITEM_MARK_RE = /(?:^|\s)((?:[А-ЯЁA-Ea-e]|\d{1,2})[.)]\s+)/g;

export const isTableRow = (line: string) => line.includes(SEP);

const splitRow = (line: string) => line.split(SEP).map((c) => c.trim());

export function countListMarks(line: string): number {
  const re = new RegExp(ITEM_MARK_RE.source, "g");
  return [...line.matchAll(re)].length;
}

/** Разбивает «Заголовок А) … Б) …» на title + items (каждый item с маркером). */
export function parseListColumn(line: string): ListColumn {
  const re = new RegExp(ITEM_MARK_RE.source, "g");
  const marks = [...line.matchAll(re)];
  if (marks.length === 0) return { title: line.trim(), items: [] };
  const title = line.slice(0, marks[0].index).trim();
  const items: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    // full match может начинаться с пробела; group 1 — сам маркер «А) »
    const itemStart = m.index! + m[0].length - m[1].length;
    const itemEnd = i + 1 < marks.length ? marks[i + 1].index! : line.length;
    items.push(line.slice(itemStart, itemEnd).trim());
  }
  return { title, items };
}

/** Одна строка → текст / список / две колонки соответствия. */
export function expandInlineListLine(line: string): StatementBlock[] {
  const marks = countListMarks(line);
  if (marks < 2) return [{ kind: "text", text: line }];

  if (line.includes(SEP)) {
    const parts = line.split(SEP).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2 && countListMarks(parts[0]) >= 2 && countListMarks(parts[1]) >= 2) {
      return [{ kind: "match", left: parseListColumn(parts[0]), right: parseListColumn(parts[1]) }];
    }
    // «шапка | колонки» без списков — не трогаем здесь (таблицы собирает parseStatementBlocks)
  }

  const col = parseListColumn(line);
  if (col.items.length >= 2) return [{ kind: "list", title: col.title, items: col.items }];
  return [{ kind: "text", text: line }];
}

/** Строки → абзацы, списки, таблицы. Таблица — минимум две подряд идущие строки с « | » (одиночная строка с «a | b» —
 *  скорее запись «a делит b» или схлопнутое соответствие — пробуем expandInlineListLine). */
export function parseStatementBlocks(lines: string[]): StatementBlock[] {
  const blocks: StatementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      blocks.push(...expandInlineListLine(lines[i]));
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isTableRow(lines[j])) j++;
    if (j - i < 2) {
      blocks.push(...expandInlineListLine(lines[i]));
      i = j;
      continue;
    }
    blocks.push({ kind: "table", rows: buildRows(lines.slice(i, j).map(splitRow)) });
    i = j;
  }
  return blocks;
}

/** Ряды → ячейки. Ряд на одну ячейку короче самого широкого — «шапка без угловой ячейки» (названия колонок при
 *  подписях рядов слева): слева добавляем пустую. Ряд ещё короче — заголовок над таблицей: последняя ячейка
 *  растягивается на оставшиеся колонки. Шапкой считаются первый ряд и такие «укороченные» ряды сразу за ним. */
function buildRows(raw: string[][]): TableCell[][] {
  const cols = Math.max(...raw.map((r) => r.length));
  let inHeader = true;
  return raw.map((cells, idx) => {
    const short = cells.length < cols;
    if (idx > 0 && !short) inHeader = false;
    const header = inHeader && (idx === 0 || short);
    if (cells.length === cols) return cells.map((text) => ({ text, colSpan: 1, header }));
    if (cells.length === cols - 1) return [{ text: "", colSpan: 1, header }, ...cells.map((text) => ({ text, colSpan: 1, header }))];
    return cells.map((text, k) => ({ text, colSpan: k === cells.length - 1 ? cols - cells.length + 1 : 1, header }));
  });
}
