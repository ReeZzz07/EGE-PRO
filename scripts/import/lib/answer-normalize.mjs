// Сравнение двух независимых ответов модели на одно и то же задание (solve vs verify).
// Логика нормализации перекликается с src/lib/utils.ts::checkAnswer, но здесь сравниваем
// «ответ А» с «ответ Б», а не ответ ученика с эталоном.

export function normalize(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/,/g, ".")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

/** Для ответов-наборов цифр («13», «1,3», «1 3») порядок может быть не важен в некоторых типах — сравниваем и как строку, и как отсортированный набор символов. */
export function answersMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const digitsOnly = (s) => s.replace(/[^0-9a-zа-я.-]/g, "");
  if (digitsOnly(na) === digitsOnly(nb)) return true;
  const sortedDigits = (s) => digitsOnly(s).split("").sort().join("");
  if (/^[0-9]+$/.test(digitsOnly(na)) && sortedDigits(na) === sortedDigits(nb)) return true;
  return false;
}
