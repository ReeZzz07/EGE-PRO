// Условия заданий приходят из импорта построчно (см. dbTasks.ts → toEgeTask), а таблицы из исходного HTML
// превращены в строки вида «Калий, мг | 238 | 240 | 520 | 190» — по одной строке на ряд таблицы. Чтобы их можно
// было показать таблицей, подряд идущие строки с « | » собираем обратно в блок-таблицу.

export interface TableCell {
  text: string;
  /** сколько колонок занимает ячейка (у строк-заголовков короче остальных последняя ячейка растягивается) */
  colSpan: number;
  header: boolean;
}

export type StatementBlock = { kind: "text"; text: string } | { kind: "table"; rows: TableCell[][] };

const SEP = " | ";

export const isTableRow = (line: string) => line.includes(SEP);

const splitRow = (line: string) => line.split(SEP).map((c) => c.trim());

/** Строки → абзацы и таблицы. Таблица — минимум две подряд идущие строки с « | » (одиночная строка с «a | b» —
 *  скорее запись «a делит b» или обычный текст, её не трогаем). */
export function parseStatementBlocks(lines: string[]): StatementBlock[] {
  const blocks: StatementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      blocks.push({ kind: "text", text: lines[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && isTableRow(lines[j])) j++;
    if (j - i < 2) {
      blocks.push({ kind: "text", text: lines[i] });
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
