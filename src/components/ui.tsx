import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
function inlineFormat(body: string): ReactNode[] {
  const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, j) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={j} className="font-extrabold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={j}>{p}</span>
    )
  );
}

/** Лёгкий markdown-lite рендер ответов ИИ-репетитора (чат + подсказки в SolveView): модель время
 *  от времени отвечает не голым текстом, а с "###"-заголовками, списками через "•"/"-" и **bold** —
 *  без разбора это выглядело сырым текстом с видимыми решётками/звёздочками. Не полноценный
 *  markdown (кода/ссылок/таблиц не бывает в этих ответах по построению промпта), нарочно минимально. */
export function TutorText({ text, light = false }: { text: string; light?: boolean }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const textCls = light ? "text-paper/85" : "text-ink/85";
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const heading = trimmed.match(/^#{1,6}\s+(.+)/);
        if (heading) {
          return (
            <p key={i} className={`font-bold ${light ? "text-paper" : "text-ink"}`}>
              {inlineFormat(heading[1])}
            </p>
          );
        }
        // "• " и "- " — оба часто встречаются как маркер списка у модели; нумерация вида "1)"
        // намеренно не трогаем — это цифры пунктов самого задания в тексте, а не список подсказки.
        const isBullet = /^[•-]\s/.test(trimmed);
        const body = trimmed.replace(/^[•-]\s*/, "");
        return (
          <p key={i} className={isBullet ? `flex gap-2 ${textCls}` : textCls}>
            {isBullet && <span className={`mt-[0.5em] h-1.5 w-1.5 shrink-0 rotate-45 ${light ? "bg-hl" : "bg-blue"}`} />}
            <span>{inlineFormat(body)}</span>
          </p>
        );
      })}
    </div>
  );
}
