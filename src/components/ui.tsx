import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import { parseStatementBlocks } from "../lib/statementBlocks";

/* ─────────── Иконки (свои, штриховые) ─────────── */
const PATHS: Record<string, ReactNode> = {
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.8 1.8M9.5 2.5h5M12 2.5v3.5" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5h16v11H10l-5 4v-4H4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2.5 2.5 0 0 1 2.5-2.5H20V19H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 19V5M8 7h8M8 10.5h5" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrowR: <path d="M4 12h15M13 5.5L19.5 12 13 18.5" />,
  arrowL: <path d="M20 12H5M11 5.5L4.5 12l6.5 6.5" />,
  star: <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z" />,
  flame: <path d="M12 3s1 3.2-1.5 6C8.4 11.3 7 13 7 15.5a5 5 0 0 0 10 0c0-1.6-.7-3-1.5-4.2-.4 1-1.2 1.7-2 1.7 1-2.5.5-6.5-1.5-10z" />,
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16v-5M12.5 16V8M17 16v-8.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
  bulb: (
    <>
      <path d="M8.5 18h7M9.5 21h5M12 3a6 6 0 0 1 3.7 10.7c-.8.7-1.2 1.5-1.2 2.3H9.5c0-.8-.4-1.6-1.2-2.3A6 6 0 0 1 12 3z" />
    </>
  ),
  refresh: <path d="M5 12a7 7 0 0 1 12.3-4.6L20 10M19 12a7 7 0 0 1-12.3 4.6L4 14M20 4.5V10h-5.5M4 19.5V14h5.5" />,
  trash: <path d="M4.5 6.5h15M9.5 6V4h5v2M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6" />,
  send: <path d="M3.5 11.5L20.5 4l-4.5 16.5-4-6.5zM12 14l8.5-10" />,
  spark: <path d="M12 2.5L14 9l6.5 2-6.5 2-2 6.5L10 13l-6.5-2L10 9z" />,
  sigma: <path d="M17.5 7V4.5h-11L13 12l-6.5 7.5h11V17" />,
  home: <path d="M4 11l8-7 8 7v9.5h-5.5V14h-5v6.5H4z" />,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  alert: <path d="M12 3L2.5 20h19zM12 9.5V14M12 16.8v.2" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </>
  ),
  print: (
    <>
      <path d="M7 8.5V3.5h10v5" />
      <path d="M6 17.5H4.5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4.5 8.5h15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H18" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11M8 11l4 4 4-4" />
      <path d="M4.5 16.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20.5v-11M8 12.5l4-4 4 4" />
      <path d="M4.5 16.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.2-4.2 4.4-6.3 7.5-6.3s6.3 2.1 7.5 6.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.4M12 18.6V21M4.2 12H2M22 12h-2.2M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M18.3 5.7l-1.5 1.5M7.2 16.8l-1.5 1.5" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5M9 21h6" />
    </>
  ),
};

export function Icon({ name, size = 20, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/* ─────────── Появление при скролле ─────────── */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("is-on");
            io.disconnect();
          }
        });
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ─────────── Кольцо прогресса ─────────── */
export function ProgressRing({ value, size = 64, stroke = 7, color = "var(--color-blue)", track = "rgba(21,23,46,0.12)", label }: { value: number; size?: number; stroke?: number; color?: string; track?: string; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [off, setOff] = useState(c);
  useEffect(() => {
    const id = setTimeout(() => setOff(c - c * Math.min(1, Math.max(0, value))), 60);
    return () => clearTimeout(id);
  }, [value, c]);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="ring-anim" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{label}</div>
    </div>
  );
}

/* ─────────── Печать «ЗАЧТЕНО» ─────────── */
export function Stamp({ text, tone = "green" }: { text: string; tone?: "green" | "red" }) {
  return (
    <span className={`stamp-mark anim-stamp inline-block text-lg sm:text-2xl font-bold ${tone === "green" ? "text-green" : "text-red"}`}>
      {text}
    </span>
  );
}

/* ─────────── Взрыв частиц ─────────── */
export function Burst({ trigger, colors = ["#2447e9", "#e03a26", "#0c8a5a", "#d98a0b", "#ffe45e"] }: { trigger: number; colors?: string[] }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        bx: `${(Math.random() - 0.5) * 260}px`,
        by: `${-30 - Math.random() * 180}px`,
        color: colors[i % colors.length],
        size: 6 + Math.random() * 8,
        delay: Math.random() * 0.08,
        round: i % 3 === 0,
      })),
    [trigger, colors]
  );
  if (!trigger) return null;
  return (
    <div key={trigger} className="pointer-events-none absolute left-1/2 top-1/2 z-30">
      {bits.map((b, i) => (
        <span
          key={i}
          className="burst-bit absolute block"
          style={{
            width: b.size,
            height: b.round ? b.size : b.size * 0.55,
            background: b.color,
            borderRadius: b.round ? "50%" : "2px",
            ["--bx" as string]: b.bx,
            ["--by" as string]: b.by,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────── Тосты ─────────── */
interface Toast {
  id: number;
  text: string;
  tone: "ok" | "err" | "info";
}
const ToastCtx = createContext<{ push: (text: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = (text: string, tone: Toast["tone"] = "info") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[70] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-popin flex items-center gap-2.5 border-2 px-4 py-2.5 font-bold text-sm shadow-lg ${
              t.tone === "ok"
                ? "bg-night text-paper border-night"
                : t.tone === "err"
                ? "bg-red text-white border-red"
                : "bg-sheet text-ink border-ink"
            }`}
            style={{ animation: "popin .4s cubic-bezier(.2,1.4,.4,1) both" }}
          >
            <Icon name={t.tone === "ok" ? "check" : t.tone === "err" ? "alert" : "spark"} size={17} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside provider");
  return ctx;
}

/* ─────────── Разметка текста репетитора (**жирный**, • маркеры) ─────────── */
/** Разбивает строку на текст/**bold** сегменты — общая логика для обычных строк и заголовков. */
// Модель (особенно на математике/физике/химии) регулярно пишет формулы в LaTeX — \[ ... \] для
// формулы на отдельной строке, \( ... \) внутри фразы — а не голым текстом. Без разбора это шло в
// TutorText как есть: сырые "\cdot", "\frac{}{}", обратные слэши и скобки прямо в тексте ответа
// (см. живой пример — жалоба на "лишние символы"). Формулы других видов (LaTeX $ $ / $$ $$) в
// живых ответах модели не встречались — этот проект не претендует на полный LaTeX, только на то,
// что модель реально пишет по построению промпта.
const INLINE_MATH_RE = /\\\(([\s\S]+?)\\\)/g;
// \[ ... \] у модели нередко разбит по строкам ("\[\n\cos(x) = 0,6\n\]") — раз в TutorText текст
// сперва режется по "\n" на параграфы, регэксп внутри ОДНОЙ строки такой блок никогда не увидит.
// Поэтому блочные формулы вырезаются из ВСЕГО текста ДО построчной разбивки (см. splitDisplayMath).
const DISPLAY_MATH_BLOCK_RE = /\\\[([\s\S]*?)\\\]/g;

function renderMath(latex: string, displayMode: boolean, key: string | number): ReactNode {
  try {
    const html = katex.renderToString(latex, { displayMode, throwOnError: true, output: "html" });
    return <span key={key} className={displayMode ? "my-1 block text-center" : "px-0.5"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // Модель иногда пишет невалидный LaTeX — тогда честнее показать исходный текст, чем сломанную
    // формулу или блок с katex-ошибкой на весь экран.
    const raw = displayMode ? `\\[${latex}\\]` : `\\(${latex}\\)`;
    return <span key={key}>{raw}</span>;
  }
}

function formatBold(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, j) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={`${keyPrefix}-${j}`} className="font-extrabold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${j}`}>{p}</span>
    )
  );
}

/** Инлайн-форматирование ОДНОЙ строки прозы: \( ... \) формулы (однострочные по построению — это
 *  разметка "внутри фразы") и **bold**. Блочные \[ ... \] сюда не попадают — они вырезаны раньше. */
function inlineFormat(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let segmentIndex = 0;
  for (const m of body.matchAll(INLINE_MATH_RE)) {
    if (m.index! > lastIndex) nodes.push(...formatBold(body.slice(lastIndex, m.index), `t${segmentIndex}`));
    nodes.push(renderMath(m[1].trim(), false, `m${segmentIndex}`));
    lastIndex = m.index! + m[0].length;
    segmentIndex++;
  }
  if (lastIndex < body.length) nodes.push(...formatBold(body.slice(lastIndex), `t${segmentIndex}`));
  return nodes;
}

/** Режет весь текст на прозу и блочные \[ ... \] формулы (которые могут занимать несколько строк
 *  внутри самих \[ \]). Прозу дальше режет на строки/параграфы вызывающий код, как раньше. */
function splitDisplayMath(text: string): Array<{ math: string } | { prose: string }> {
  const parts: Array<{ math: string } | { prose: string }> = [];
  let lastIndex = 0;
  for (const m of text.matchAll(DISPLAY_MATH_BLOCK_RE)) {
    if (m.index! > lastIndex) parts.push({ prose: text.slice(lastIndex, m.index) });
    parts.push({ math: m[1].trim() });
    lastIndex = m.index! + m[0].length;
  }
  if (lastIndex < text.length) parts.push({ prose: text.slice(lastIndex) });
  return parts;
}

/** Лёгкий markdown-lite рендер ответов ИИ-репетитора (чат + подсказки в SolveView): модель время
 *  от времени отвечает не голым текстом, а с "###"-заголовками, списками через "•"/"-", **bold** и
 *  LaTeX-формулами — без разбора это выглядело сырым текстом с видимыми решётками/звёздочками/
 *  обратными слэшами. Не полноценный markdown (кода/ссылок/таблиц не бывает в этих ответах по
 *  построению промпта), нарочно минимально. */
export function TutorText({ text, light = false }: { text: string; light?: boolean }) {
  const textCls = light ? "text-paper/85" : "text-ink/85";
  const parts = splitDisplayMath(text);
  return (
    <div className="space-y-1.5">
      {parts.map((part, pi) => {
        if ("math" in part) return renderMath(part.math, true, `dm${pi}`);
        const lines = part.prose.split("\n").filter((l) => l.trim() !== "");
        return lines.map((line, i) => {
          const trimmed = line.trim();
          const heading = trimmed.match(/^#{1,6}\s+(.+)/);
          if (heading) {
            return (
              <p key={`${pi}-${i}`} className={`font-bold ${light ? "text-paper" : "text-ink"}`}>
                {inlineFormat(heading[1])}
              </p>
            );
          }
          // "• " и "- " — оба часто встречаются как маркер списка у модели; нумерация вида "1)"
          // намеренно не трогаем — это цифры пунктов самого задания в тексте, а не список подсказки.
          const isBullet = /^[•-]\s/.test(trimmed);
          const body = trimmed.replace(/^[•-]\s*/, "");
          return (
            <p key={`${pi}-${i}`} className={isBullet ? `flex gap-2 ${textCls}` : textCls}>
              {isBullet && <span className={`mt-[0.5em] h-1.5 w-1.5 shrink-0 rotate-45 ${light ? "bg-hl" : "bg-blue"}`} />}
              <span>{inlineFormat(body)}</span>
            </p>
          );
        });
      })}
    </div>
  );
}

/* ─────────── Формулы/картинки внутри условия задания ─────────── */
// Заданиях из автоматического импорта (scripts/import/lib/clean-html.mjs, только для источников
// fipi_auto_solve/neofamily) на месте каждой убранной из HTML картинки в тексте стоит маркер
// "[ИЗОБРАЖЕНИЕ N]" — 1-based номер по порядку появления в исходном условии, N-я картинка задания
// (task.images, тот же порядок). Раньше маркеры вырезались пробелом, а все картинки показывались
// отдельным блоком ПОСЛЕ текста — предложение вида "на сторонах  и  отмечены точки  и " разваливалось
// на бессмысленные обрывки, потому что то, что должно было стоять на месте пробелов (имена точек,
// отрезков, формулы), пряталось в отдельном блоке ниже, без всякой видимой связи с текстом.
const IMAGE_MARKER_RE = /\[ИЗОБРАЖЕНИЕ\s*(\d*)\]/gi;

/** Индексы (0-based, как в task.images) картинок, на которые ссылается хоть один маркер в тексте —
 *  остальные картинки задания к тексту не привязаны (ручной/ZIP-импорт вообще не расставляет
 *  маркеры, см. docker/api/importArchive.js) и должны показываться отдельным блоком, как раньше. */
export function usedImageMarkerIndices(statement: string[]): Set<number> {
  const used = new Set<number>();
  for (const line of statement) {
    for (const m of line.matchAll(IMAGE_MARKER_RE)) {
      if (m[1]) used.add(Number(m[1]) - 1);
    }
  }
  return used;
}

// Записи для аудирования (см. clean-html.mjs) приходят без корректного заголовка длительности —
// <audio> сперва знает только, что duration = NaN/Infinity, и до первого реального проигрывания
// считает прогресс-бар от этого неизвестного значения, поэтому ползунок стоит не там, где реально
// идёт воспроизведение. Известный обход (Chromium и большинство движков): перемотать на заведомо
// большее время, чем есть в файле — это форсирует полное сканирование и настоящую длительность в
// durationChange, откуда возвращаем currentTime обратно к 0. Метим элемент, чтобы вернуть именно
// свою перемотку — а не сбросить позицию на 0, если durationchange придёт по другой причине.
const fixingDuration = new WeakSet<HTMLAudioElement>();
function seekToDiscoverDuration(el: HTMLAudioElement) {
  if (Number.isFinite(el.duration)) return;
  fixingDuration.add(el);
  el.currentTime = 1e10;
}
function resetAfterDurationDiscovered(el: HTMLAudioElement) {
  if (!fixingDuration.has(el) || !Number.isFinite(el.duration)) return;
  fixingDuration.delete(el);
  el.currentTime = 0;
}

/** Одно вложение задания — по расширению файла решает, как его показать: .mp3 — запись для
 *  аудирования (см. <audio> в clean-html.mjs — сама запись, а не иллюстрация, поэтому плеер на всю
 *  ширину, а не картинка), .svg — формула Wiris без своего "фото-обрамления", в натуральном размере (Wiris рисует её сразу под нужный кегль — принудительная высота сжимала дроби и степени до нечитаемых),
 *  остальное — настоящая иллюстрация/чертёж, крупнее и в рамке. */
export function MediaItem({ src }: { src: string }) {
  if (/\.mp3$/i.test(src)) {
    return (
      <audio
        src={src}
        controls
        className="my-1 block w-full max-w-md"
        onLoadedMetadata={(e) => seekToDiscoverDuration(e.currentTarget)}
        onDurationChange={(e) => resetAfterDurationDiscovered(e.currentTarget)}
      />
    );
  }
  return <LoadingImage key={src} src={src} isFormula={/\.svg$/i.test(src)} />;
}

/** Картинка с заглушкой на время загрузки: при медленной сети на месте формулы/рисунка не пустота (текст
 *  «Найдите значение выражения .» выглядел бы оборванным), а мерцающий прямоугольник; если файл не пришёл —
 *  «повторить». Пока грузится, сам <img> остаётся в DOM (невидимым), иначе браузер не стал бы качать. */
function LoadingImage({ src, isFormula }: { src: string; isFormula: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  const url = attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;

  // картинка из кэша браузера могла загрузиться раньше, чем React повесил onLoad
  useLayoutEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) setState("ok");
  }, [url]);

  const alt = isFormula ? "формула" : "Иллюстрация к заданию";
  const skeleton = isFormula ? "h-6 w-14 align-middle" : "h-40 w-56 max-w-full align-middle";
  return (
    <>
      {state === "loading" && (
        <span role="img" aria-busy="true" aria-label="Изображение загружается" className={`mx-1 inline-block rounded-sm bg-ink/10 motion-safe:animate-pulse ${skeleton}`} />
      )}
      {state === "error" && (
        <button
          type="button"
          onClick={() => {
            setState("loading");
            setAttempt((n) => n + 1);
          }}
          className="mx-1 inline-flex items-center gap-1 rounded-sm border border-ink/20 px-1.5 py-0.5 align-middle text-[12px] font-semibold text-ink2 hover:text-ink"
        >
          <Icon name="refresh" size={12} /> {isFormula ? "формула не загрузилась" : "изображение не загрузилось"} — повторить
        </button>
      )}
      <img
        ref={ref}
        src={url}
        alt={alt}
        onLoad={() => setState("ok")}
        onError={() => setState("error")}
        className={
          state !== "ok"
            ? "pointer-events-none absolute h-0 w-0 opacity-0"
            : isFormula
              ? "mx-0.5 inline-block max-w-full align-middle"
              : "mx-1 inline-block max-h-72 w-auto rounded-sm border-2 border-ink/15 align-middle object-contain"
        }
      />
    </>
  );
}

/** Вклеивает вложение (формулу/аудио/иллюстрацию — см. MediaItem) прямо на место маркера в тексте.
 *  Маркер, на который ссылается, но которого физически нет (см. давний баг с обрезкой до 4 картинок
 *  на задание в publish-neofamily.mjs — старые задания могли остаться недозалитыми), просто пропадает,
 *  без сломанной иконки на его месте. */
export function StatementLine({ text, images }: { text: string; images?: string[] }) {
  const parts = text.split(IMAGE_MARKER_RE);
  // split с capturing group чередует: текст, номер-маркера(или ""), текст, номер, текст...
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part ? <span key={i}>{part}</span> : null;
        const src = part ? images?.[Number(part) - 1] : undefined;
        return src ? <MediaItem key={i} src={src} /> : null;
      })}
    </>
  );
}

/** Условие задания целиком: строки с формулами на местах маркеров + картинки без маркера отдельным блоком
 *  (то же, что SolveView). Диагностика и пробник раньше печатали строки как есть — вместо формулы
 *  ученик видел «[ИЗОБРАЖЕНИЕ 1]». */
export function TaskStatement({ task, className = "space-y-2" }: { task: { statement: string[]; images?: string[] }; className?: string }) {
  const extra = (task.images ?? []).filter((_, i) => !usedImageMarkerIndices(task.statement).has(i));
  return (
    <>
      <div className={className}>
        <StatementBody statement={task.statement} images={task.images} />
      </div>
      {extra.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {extra.map((src, i) => <MediaItem key={i} src={src} />)}
        </div>
      )}
    </>
  );
}

/** Строка условия для коротких превью (line-clamp) в списках: без служебных маркеров картинок. */
export function statementPreview(line: string | undefined): string {
  return (line ?? "").replace(IMAGE_MARKER_RE, "…").replace(/(?:…\s*){2,}/g, "… ").replace(/\s{2,}/g, " ").trim();
}

/** Строки условия → абзацы и таблицы (строки «a | b | c» подряд — это таблица из исходного задания, см.
 *  lib/statementBlocks.ts). Пользователь: «содержание таблицы прослеживается, но не показывается таблицей —
 *  неудобно читать, а люди платят за удобство» (26.09.2026). */
export function StatementBody({ statement, images }: { statement: string[]; images?: string[] }) {
  return (
    <>
      {parseStatementBlocks(statement).map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="[overflow-wrap:anywhere]">
            <StatementLine text={b.text} images={images} />
          </p>
        ) : (
          <div key={i} className="max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-[14px] leading-snug" data-testid="statement-table">
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, k) => {
                      const Cell = c.header ? "th" : "td";
                      return (
                        <Cell
                          key={k}
                          colSpan={c.colSpan}
                          className={`border border-ink/25 px-2.5 py-1.5 align-top ${c.header ? "bg-ink/5 text-left font-bold" : k === 0 ? "font-semibold" : "tabular-nums"}`}
                        >
                          <StatementLine text={c.text} images={images} />
                        </Cell>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
