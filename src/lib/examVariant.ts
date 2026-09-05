// Структура реального экзамена по предмету — не хардкод, а то, что действительно есть в
// импортированном банке ФИПИ: у каждого задания уже проставлен реальный номер в структуре ЕГЭ
// (egeNumber, см. dbTasks.ts). Один номер = одна позиция в варианте, баллы за неё — модальное
// значение среди заданий этой позиции (у подавляющего большинства позиций оно единственное; для
// нескольких предметов после импорта встречаются единичные расхождения — ими можно пренебречь,
// т.к. это не то же самое, что писать структуру заново руками). Требует, чтобы предмет был уже
// подгружен целиком (см. hydrateSubjectTasks) — иначе часть позиций будет не видна.
import { TASKS, type EgeTask, type Subject } from "../data/tasks";

export interface ExamPosition {
  egeNumber: number;
  points: number;
  essay: boolean;
}

function groupBySubject(subject: Subject): Map<number, EgeTask[]> {
  const byNumber = new Map<number, EgeTask[]>();
  for (const t of TASKS) {
    if (t.subject !== subject || !t.egeNumber) continue;
    const arr = byNumber.get(t.egeNumber);
    if (arr) arr.push(t);
    else byNumber.set(t.egeNumber, [t]);
  }
  return byNumber;
}

function derivePositions(byNumber: Map<number, EgeTask[]>): ExamPosition[] {
  const positions: ExamPosition[] = [];
  for (const [egeNumber, tasks] of byNumber) {
    const pointsCounts = new Map<number, number>();
    for (const t of tasks) pointsCounts.set(t.points, (pointsCounts.get(t.points) ?? 0) + 1);
    const modalPoints = [...pointsCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const essayCount = tasks.filter((t) => t.answerType === "essay").length;
    positions.push({ egeNumber, points: modalPoints, essay: essayCount * 2 > tasks.length });
  }
  return positions.sort((a, b) => a.egeNumber - b.egeNumber);
}

/** Реальная структура варианта: по одной позиции на каждый номер задания ЕГЭ, встречающийся в
 *  банке по предмету. Стабильна независимо от того, какой конкретно набор заданий выпадет в
 *  случайной генерации (см. pickExamVariant) — это то, что можно честно показать на экране
 *  настройки ДО того, как вариант сгенерирован. */
export function getExamStructure(subject: Subject): ExamPosition[] {
  return derivePositions(groupBySubject(subject));
}

/** Один случайный вариант — по одному случайно выбранному заданию на каждую позицию реальной
 *  структуры экзамена, так что при каждом новом заходе состав меняется, а структура (число и
 *  типы заданий) — нет. includeEssay=false — часть с развёрнутым ответом (проверка ИИ по
 *  критериям) целиком исключается, а не подменяется усечением одного задания: применимо, когда
 *  тариф ученика не даёт проверку сочинений (см. lib/tariffs.ts). */
export function pickExamVariant(subject: Subject, includeEssay: boolean): EgeTask[] {
  const byNumber = groupBySubject(subject);
  const positions = derivePositions(byNumber);
  const variant: EgeTask[] = [];
  for (const pos of positions) {
    if (pos.essay && !includeEssay) continue;
    const atPosition = byNumber.get(pos.egeNumber) ?? [];
    const matching = atPosition.filter((t) => (pos.essay ? t.answerType === "essay" : t.answerType !== "essay"));
    const pool = matching.length ? matching : atPosition;
    if (!pool.length) continue;
    variant.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return variant;
}
