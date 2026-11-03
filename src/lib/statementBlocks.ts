// Условия заданий приходят из импорта построчно (см. dbTasks.ts → toEgeTask), а таблицы из исходного HTML
// превращены в строки вида «Калий, мг | 238 | 240 | 520 | 190» — по одной строке на ряд таблицы. Чтобы их можно
// было показать таблицей, подряд идущие строки с « | » собираем обратно в блок-таблицу.
//
// Отдельно: задания на соответствие часто приходят ОДНОЙ строкой без переносов и иногда БЕЗ пробелов
// вокруг маркеров: «…O2Б) KClO3… | …-12) -2…» (= «-1» + «2)»). Разворачиваем в списки / две колонки.

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

/** Табличные ряды из импорта — именно « | » с пробелами (чтобы «3 | n» не считался таблицей). */
const SEP = " | ";

export type ListMark = { index: number; length: number };

/**
 * Маркеры пунктов соответствия/выбора.
 * Буквы А–Е (и A–E) — даже вплотную к формуле (O2Б), СИСТЕМУА)).
 * Цифры 1)–9) — в т.ч. после числа предыдущего пункта («→ -12)» = «-1»+«2)»).
 * Только одна цифра: иначе «12)» съело бы «-1»+«2)» как пункт «12)». Не внутри «(1)».
 */
export function findListMarks(line: string): ListMark[] {
  const marks: ListMark[] = [];
  for (const m of line.matchAll(/[А-ЕA-Ea-e][.)]/g)) {
    marks.push({ index: m.index!, length: m[0].length });
  }
  for (const m of line.matchAll(/[1-9][.)]/g)) {
    const index = m.index!;
    if (index > 0 && line[index - 1] === "(") continue;
    marks.push({ index, length: m[0].length });
  }
  marks.sort((a, b) => a.index - b.index || b.length - a.length);
  const out: ListMark[] = [];
  for (const m of marks) {
    const prev = out[out.length - 1];
    if (prev && m.index < prev.index + prev.length) continue;
    out.push(m);
  }
  return out;
}

export const isTableRow = (line: string) => line.includes(SEP);

const splitRow = (line: string) => line.split(SEP).map((c) => c.trim());

export function countListMarks(line: string): number {
  return findListMarks(line).length;
}

/** Разбивает «ЗаголовокА)…Б)…» / «Заголовок А) … Б) …» на title + items. */
export function parseListColumn(line: string): ListColumn {
  const marks = findListMarks(line);
  if (marks.length === 0) return { title: line.trim(), items: [] };
  const title = line.slice(0, marks[0].index).trim();
  const items: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : line.length;
    items.push(line.slice(start, end).trim());
  }
  return { title, items };
}

/** Одна строка → текст / список / две колонки соответствия. */
export function expandInlineListLine(line: string): StatementBlock[] {
  const marks = countListMarks(line);
  if (marks < 2) return [{ kind: "text", text: line }];

  // «лево | право» — с пробелами или вплотную
  if (line.includes("|")) {
    const parts = line
      .split(/\s*\|\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 2 && countListMarks(parts[0]) >= 2 && countListMarks(parts[1]) >= 2) {
      return [{ kind: "match", left: parseListColumn(parts[0]), right: parseListColumn(parts[1]) }];
    }
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
