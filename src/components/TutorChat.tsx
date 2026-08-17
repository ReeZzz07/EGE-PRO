import { useEffect, useRef, useState } from "react";
import { getTutorReply } from "../data/tutor";
import type { EgeTask } from "../data/tasks";
import { taskById, SUBJECTS } from "../data/tasks";
import { useProgress } from "../lib/store";
import { TutorText } from "./ui";

interface Msg {
  role: "user" | "bot";
  text: string;
  actions?: string[];
  streaming?: boolean;
}

const CHAT_KEY = "ege-pro.chat.v2";

const WELCOME: Msg = {
  role: "bot",
  text: "Привет! Я — ИИ-репетитор ЕГЭ·ПРО 👋\n\nОткрой задание в банке — дам три уровневые подсказки и полный разбор. Или спроси о чём угодно: «объясни логарифмы», «мои ошибки», «как считаются баллы», «составь план подготовки».",
  actions: ["Что ты умеешь?", "Составь план подготовки", "Объясни вероятность"],
};

export default function TutorChat({ contextTask, compact = false, onNavigate }: { contextTask?: EgeTask; compact?: boolean; onNavigate?: (dest: string) => void }) {
  const { derived } = useProgress();
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Msg[];
        if (Array.isArray(parsed) && parsed.length) return parsed.map((m) => ({ ...m, streaming: false }));
      }
    } catch {
      /* ignore */
    }
    return [WELCOME];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const hintLevelRef = useRef(0);
  const ctxTaskRef = useRef<string | undefined>(undefined);
  const streamTimer = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // контекст текущего задания
  useEffect(() => {
    if (contextTask && ctxTaskRef.current !== contextTask.id) {
      ctxTaskRef.current = contextTask.id;
      hintLevelRef.current = 0;
      // не дублируем контекстное сообщение, если оно уже последнее в истории
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (lastMsg && lastMsg.role === "bot" && lastMsg.text.includes(`№ ${contextTask.fipiId}`)) return;
      const meta = SUBJECTS[contextTask.subject];
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text: `📌 Работаем над заданием **№ ${contextTask.fipiId}** (банк ФИПИ) — «${contextTask.topic}», ${meta.name}.\n\nНачни с «**подсказка**» — дам первую наводку, не раскрывая решения. Или сразу «**объясни решение**».`,
          actions: ["Подсказка", "Объясни решение"],
        },
      ]);
    }
    if (!contextTask) ctxTaskRef.current = undefined;
  }, [contextTask]);

  // сохранение (только когда не идёт стриминг)
  useEffect(() => {
    if (busy) return;
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => () => {
    if (streamTimer.current) window.clearInterval(streamTimer.current);
  }, []);

  const streamIn = (reply: { text: string; actions?: string[]; bumpHint?: boolean }) => {
    if (reply.bumpHint) hintLevelRef.current = Math.min(3, hintLevelRef.current + 1);
    setBusy(true);
    const words = reply.text.split(/(\s+)/);
    let i = 0;
    streamTimer.current = window.setInterval(() => {
      i += 3;
      const partial = words.slice(0, i).join("");
      const done = i >= words.length;
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.streaming) {
          copy[copy.length - 1] = { ...last, text: partial, streaming: !done, actions: done ? reply.actions : undefined };
        }
        return copy;
      });
      if (done) {
        if (streamTimer.current) window.clearInterval(streamTimer.current);
        streamTimer.current = null;
        setBusy(false);
      }
    }, 24);
    setMessages((m) => [...m, { role: "bot", text: "", streaming: true }]);
  };

  const send = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");

    // служебные действия-переходы
    if (text === "В банк заданий" || text === "Подбери похожее задание") {
      onNavigate?.("bank");
      return;
    }
    if (text === "Я решил!") {
      setMessages((m) => [
        ...m,
        { role: "user", text },
        { role: "bot", text: "Отлично! 🔥 Введи ответ в бланк — система сверит его с эталоном ФИПИ и начислит первичные баллы.", actions: ["Подсказка"] },
      ]);
      return;
    }

    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    const mistakeTasks = [...derived.mistakeIds].map((id) => taskById(id)).filter((t): t is EgeTask => !!t);
    const reply = getTutorReply(text, {
      task: contextTask,
      hintLevel: hintLevelRef.current,
      mistakeTasks,
      solvedCount: derived.solvedIds.size,
    });
    const delay = 450 + Math.min(900, reply.text.length * 4);
    setTimeout(() => streamIn(reply), delay);
  };

  const last = messages[messages.length - 1];
  const showChips = last?.role === "bot" && !last.streaming && last.actions && !busy;

  return (
    <div className={`flex flex-col overflow-hidden rounded-md border-2 border-night bg-night text-paper ${compact ? "h-[480px]" : "h-[600px] sm:h-[640px]"}`}>
      {/* шапка */}
      <div className="gridpaper-dark flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="relative">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue text-paper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3a7 7 0 0 1 7 7c0 2.5-1.2 4-2.5 5.2V18a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-2.8C6.2 14 5 12.5 5 10a7 7 0 0 1 7-7z" />
              <path d="M9.5 10h.01M14.5 10h.01M9.5 13.2c.7.7 1.6 1 2.5 1s1.8-.3 2.5-1" />
            </svg>
          </div>
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-night bg-green" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-[13px] font-bold uppercase tracking-wide">ИИ-репетитор</div>
          <div className="text-[11px] text-paper/60">
            {busy ? "печатает…" : "онлайн · знает банк ФИПИ"}
          </div>
        </div>
        {contextTask && (
          <span className="ml-auto hidden shrink-0 rounded-sm bg-night2 px-2 py-1 font-mono text-[11px] text-paper/70 sm:block">
            № {contextTask.fipiId} · {contextTask.topic}
          </span>
        )}
      </div>

      {/* лента */}
      <div className="scrollbar-thin gridpaper-dark flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                m.role === "user" ? "rounded-md rounded-br-none bg-blue text-white" : "rounded-md rounded-bl-none border border-white/10 bg-night2 text-paper"
              }`}
            >
              {m.role === "user" ? <p>{m.text}</p> : <TutorText text={m.text} light />}
              {m.streaming && <span className="ml-1 inline-block h-3.5 w-2 translate-y-0.5 animate-[blink_1s_steps(2)_infinite] bg-hl" />}
            </div>
          </div>
        ))}

        {busy && !last?.streaming && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-night2 px-4 py-3">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-hl" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-hl" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-hl" />
            </div>
          </div>
        )}

        {showChips && (
          <div className="flex flex-wrap gap-2 pl-1">
            {last.actions!.map((a) => (
              <button
                key={a}
                onClick={() => send(a)}
                className="rounded-sm border border-hl/50 bg-hl/10 px-2.5 py-1 text-[12px] font-semibold text-hl transition hover:bg-hl hover:text-night"
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* поле ввода */}
      <div className="border-t border-white/10 bg-night p-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={contextTask ? "«подсказка», «объясни решение»…" : "Спроси о теме, плане, баллах…"}
            className="min-w-0 flex-1 rounded-sm border border-white/15 bg-night2 px-3 py-2.5 text-sm text-paper placeholder:text-paper/35 outline-none transition focus:border-hl/60"
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            aria-label="Отправить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-blue text-white transition hover:brightness-110 active:translate-y-px disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 11.5L20.5 4l-4.5 16.5-4-6.5zM12 14l8.5-10" />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["мои ошибки", "объясни логарифмы", "советы на экзамен", "сколько нужно баллов"].map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-white/12 px-2.5 py-0.5 text-[11px] text-paper/55 transition hover:border-hl/50 hover:text-hl disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
