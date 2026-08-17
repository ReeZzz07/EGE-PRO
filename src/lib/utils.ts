import { useEffect, useRef, useState } from "react";

/** Нормализация ответа ЕГЭ: регистр, запятые→точки, лишние пробелы */
export function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/,/g, ".")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkAnswer(given: string, accepted: string[]): boolean {
  const g = normalizeAnswer(given);
  if (!g) return false;
  return accepted.some((a) => {
    const n = normalizeAnswer(a);
    if (n === g) return true;
    // «1,3» ≡ «13» для ответов-наборов цифр
    const digitsOnly = (s: string) => s.replace(/[^0-9a-zа-я.-]/g, "");
    return digitsOnly(n) === digitsOnly(g);
  });
}

export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Обратный отсчёт до даты */
export function useCountdown(target: Date) {
  const calc = () => {
    const diff = Math.max(0, target.getTime() - Date.now());
    return {
      days: Math.floor(diff / 86_400_000),
      hours: Math.floor(diff / 3_600_000) % 24,
      minutes: Math.floor(diff / 60_000) % 60,
      seconds: Math.floor(diff / 1000) % 60,
      done: diff === 0,
    };
  };
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.getTime()]);
  return t;
}

/** Эффект «расшифровки» заголовка */
export function useScramble(text: string, speed = 38): string {
  const [out, setOut] = useState(text);
  const frame = useRef(0);
  useEffect(() => {
    const glyphs = "АБВГДЖЗИКЛМНПРСТУФХЦЧШЩЭЮЯ≠≈∑∫√πΔ01";
    let raf = 0;
    let last = 0;
    frame.current = 0;
    const total = text.length * 3 + 10;
    const step = (ts: number) => {
      if (ts - last > speed) {
        last = ts;
        frame.current++;
        const settled = Math.floor(frame.current / 3);
        const s = text
          .split("")
          .map((ch, i) => {
            if (ch === " " || ch === "·") return ch;
            if (i < settled) return ch;
            return glyphs[Math.floor(Math.random() * glyphs.length)];
          })
          .join("");
        setOut(s);
        if (frame.current >= total) {
          setOut(text);
          return;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, speed]);
  return out;
}

/** Детерминированный выбор «задания дня» */
export function dayIndex(len: number): number {
  const day = Math.floor(Date.now() / 86_400_000);
  return day % len;
}

/* Безопасный калькулятор арифметики для ИИ-репетитора */
type Tok = { t: "n"; v: number } | { t: "op"; v: string };

function tokenize(expr: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const v = parseFloat(expr.slice(i, j).replace(",", "."));
      if (Number.isNaN(v)) return null;
      toks.push({ t: "n", v });
      i = j;
    } else if ("+-*/^()".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
    } else return null;
  }
  return toks;
}

export function safeMathEval(expr: string): number | null {
  const toks = tokenize(expr);
  if (!toks || toks.length === 0) return null;
  let pos = 0;
  const peek = () => toks[pos];
  function parseExpr(): number | null {
    let v = parseTerm();
    if (v === null) return null;
    while (peek() && peek()!.t === "op" && (peek() as { t: "op"; v: string }).v === "+") {
      pos++;
      const r = parseTerm();
      if (r === null) return null;
      v += r;
    }
    while (peek() && peek()!.t === "op" && (peek() as { t: "op"; v: string }).v === "-") {
      pos++;
      const r = parseTerm();
      if (r === null) return null;
      v -= r;
    }
    return v;
  }
  function parseTerm(): number | null {
    let v = parsePow();
    if (v === null) return null;
    while (peek() && peek()!.t === "op") {
      const op = (peek() as { t: "op"; v: string }).v;
      if (op !== "*" && op !== "/") break;
      pos++;
      const r = parsePow();
      if (r === null) return null;
      v = op === "*" ? v * r : r === 0 ? NaN : v / r;
    }
    return v;
  }
  function parsePow(): number | null {
    const base = parseUnary();
    if (base === null) return null;
    if (peek() && peek()!.t === "op" && (peek() as { t: "op"; v: string }).v === "^") {
      pos++;
      const e = parsePow();
      if (e === null) return null;
      return Math.pow(base, e);
    }
    return base;
  }
  function parseUnary(): number | null {
    if (peek() && peek()!.t === "op" && (peek() as { t: "op"; v: string }).v === "-") {
      pos++;
      const v = parseUnary();
      return v === null ? null : -v;
    }
    return parseAtom();
  }
  function parseAtom(): number | null {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === "n") { pos++; return tk.v; }
    if (tk.t === "op" && tk.v === "(") {
      pos++;
      const v = parseExpr();
      if (v === null) return null;
      if (!peek() || peek()!.t !== "op" || (peek() as { t: "op"; v: string }).v !== ")") return null;
      pos++;
      return v;
    }
    return null;
  }
  const result = parseExpr();
  if (result === null || pos !== toks.length) return null;
  return result;
}
