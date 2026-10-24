// Демо-чат на главной: показывает принцип «подсказки без готового ответа» на живом примере.
// Ответы заранее написаны (docker/api/content/landingMore.json → chatDemo): на публичной странице настоящий вызов ИИ
// был бы лишней нагрузкой и открыл бы его всем подряд. Любой свободный текст получает вежливый отказ дать ответ либо
// напоминание, что в демо работают только подсказки.
import { useEffect, useRef, useState, type FormEvent } from "react";
import landingMore from "../../docker/api/content/landingMore.json";
import landingStatic from "../../docker/api/content/landingStatic.json";
import { Icon } from "./ui";

type Msg = { from: "user" | "ai"; text: string };

const demo = landingMore.chatDemo;
const REPLY_DELAY_MS = 650;
const MAX_MESSAGES = 24;
const ASKS_FOR_ANSWER = /ответ|скажи|реши|сколько|чему равен|чему равно/i;

const INITIAL: Msg[] = [
  { from: "user", text: landingStatic.principle.dialog[0] },
  { from: "ai", text: landingStatic.principle.dialog[1] },
];

export default function PrincipleChat({ onStart }: { onStart: () => void }) {
  const [messages, setMessages] = useState<Msg[]>(INITIAL);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // прокручиваем только сам чат, а не страницу
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  function say(ask: string, reply: string) {
    if (typing) return;
    setMessages((m) => [...m, { from: "user" as const, text: ask }].slice(-MAX_MESSAGES));
    setTyping(true);
    timer.current = setTimeout(() => {
      setMessages((m) => [...m, { from: "ai" as const, text: reply }].slice(-MAX_MESSAGES));
      setTyping(false);
    }, REPLY_DELAY_MS);
  }

  function onChip(label: string) {
    const chip = demo.chips.find((c) => c.label === label);
    if (!chip) return;
    setUsed((u) => new Set(u).add(label));
    say(chip.ask, chip.reply);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || typing) return;
    setDraft("");
    say(text, ASKS_FOR_ANSWER.test(text) ? demo.refusal : demo.fallback);
  }

  return (
    <div className="mx-auto w-full max-w-xl border-2 border-white/15 bg-night2 shadow-[8px_8px_0_0_#2447e9]">
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center border-2 border-hl bg-hl/15 text-hl">
          <Icon name="chat" size={16} />
        </span>
        <div className="leading-tight">
          <p className="font-display text-[13.5px] font-bold">{demo.headerTitle}</p>
          <p className="text-[11px] text-paper/55">{demo.headerNote}</p>
        </div>
      </div>

      <div className="border-b border-white/10 bg-night px-4 py-2.5 text-[12.5px] text-paper/75">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-hl">{demo.taskLabel}</span> · {demo.taskText}
      </div>

      <div ref={listRef} role="log" aria-live="polite" className="max-h-[19rem] min-h-[15rem] space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
        {messages.map((m, i) =>
          m.from === "user" ? (
            <div key={i} className="anim-rise ml-auto w-fit max-w-[88%] rounded-md rounded-br-none bg-blue px-4 py-2.5 text-[14px] leading-snug text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="anim-rise w-fit max-w-[92%] rounded-md rounded-bl-none border border-white/10 bg-night px-4 py-2.5 text-[14px] leading-relaxed text-paper/90">
              {m.text}
            </div>
          )
        )}
        {typing && (
          <div className="w-fit rounded-md rounded-bl-none border border-white/10 bg-night px-4 py-3" aria-label="ИИ-репетитор печатает">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-paper/60" style={{ animationDelay: `${d * 160}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 pb-1 pt-1">
        <p className="mb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-paper/50">{demo.hintTitle}</p>
        <div className="flex flex-wrap gap-2">
          {demo.chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onChip(c.label)}
              disabled={typing}
              className={`border px-3 py-1.5 text-[12.5px] font-bold transition disabled:opacity-50 ${
                used.has(c.label) ? "border-white/25 bg-white/5 text-paper/70" : "border-hl bg-hl/10 text-hl hover:bg-hl hover:text-ink"
              } ${used.size === 0 && c.label === demo.chips[0].label ? "chip-glow" : ""}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="m-4 mb-3 flex items-center border border-white/15 bg-night focus-within:border-hl">
        <label htmlFor="principle-chat-input" className="sr-only">
          {demo.placeholder}
        </label>
        <input
          id="principle-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder={demo.placeholder}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-[13.5px] text-paper outline-none placeholder:text-paper/40"
        />
        <button type="submit" disabled={!draft.trim() || typing} aria-label="Отправить" className="px-3.5 py-2.5 text-paper/70 transition hover:text-hl disabled:opacity-40">
          <Icon name="arrowR" size={16} />
        </button>
      </form>

      <div className="border-t border-white/10 px-4 py-3 text-right">
        <button type="button" onClick={onStart} className="link-slide text-[12.5px] font-bold text-hl hover:text-white">
          {demo.cta} →
        </button>
      </div>
    </div>
  );
}
