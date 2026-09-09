// Задание №39 ЕГЭ по английскому — «Чтение текста вслух» (см. components/ReadAloudView.tsx):
// ученик читает вслух готовый текст, а не пишет свой ответ, так что ни "правильного ответа" для
// автопроверки, ни ИИ-оценки по критериям тут нет — платформа не принимает и не хранит голос.
// Вместо этого — распознавание речи браузером (Web Speech API, бесплатно и без похода к внешнему
// ИИ-провайдеру) и сравнение расшифровки с эталонным текстом: какие слова ученик реально произнёс,
// а какие пропустил. Это грубая, приблизительная самопроверка (качество зависит от микрофона и
// самого распознавания), а не официальная оценка произношения/интонации — как и с сочинениями,
// экзамен проверяют эксперты по своим критериям.
export interface ReadAloudWordResult {
  /** Слово в исходном написании — для отображения (без нормализации регистра/пунктуации). */
  word: string;
  matched: boolean;
}

function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z']/g, "");
}

/** Сколько соседних слов расшифровки просматриваем в поиске совпадения для одного слова эталона —
 *  без этого одно нераспознанное/лишнее слово в транскрипте сдвигало бы всё сопоставление до конца
 *  текста (позиция ищущего указателя иначе застревала бы на первом же расхождении). */
const LOOKAHEAD = 6;

/** Сопоставляет эталонный текст с расшифровкой речи (SpeechRecognition) слово за словом: указатель
 *  идёт по расшифровке только вперёд и только при найденном совпадении — so переставленные или
 *  повторно распознанные слова в транскрипте не путают то, что идёт после. */
export function compareReadAloud(referenceText: string, transcript: string): ReadAloudWordResult[] {
  const refWords = referenceText.split(/\s+/).filter(Boolean);
  const transcriptWords = transcript.split(/\s+/).map(normalizeWord).filter(Boolean);

  let pointer = 0;
  const result: ReadAloudWordResult[] = [];
  for (const raw of refWords) {
    const norm = normalizeWord(raw);
    if (!norm) {
      // чистая пунктуация (одиночные "-"/"—" и т.п. после split) — не в счёт ни за, ни против чтеца
      result.push({ word: raw, matched: true });
      continue;
    }
    let foundAt = -1;
    for (let j = pointer; j < Math.min(transcriptWords.length, pointer + LOOKAHEAD); j++) {
      if (transcriptWords[j] === norm) {
        foundAt = j;
        break;
      }
    }
    if (foundAt >= 0) {
      result.push({ word: raw, matched: true });
      pointer = foundAt + 1;
    } else {
      result.push({ word: raw, matched: false });
    }
  }
  return result;
}

/** Доля слов эталона, для которых нашлось совпадение в расшифровке — 0..1. */
export function readAloudAccuracy(results: ReadAloudWordResult[]): number {
  if (!results.length) return 0;
  return results.filter((r) => r.matched).length / results.length;
}
