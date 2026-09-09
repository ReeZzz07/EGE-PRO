// Общая логика записи голоса + расшифровки речи браузером — используется и в ReadAloudView.tsx
// (чтение вслух, сверка с эталонным текстом), и в EssayView.tsx (диалог-расспрос/монолог —
// открытая устная речь без единого "правильного" текста, расшифровка просто становится черновиком
// ответа, который ученик может подправить перед отправкой на проверку). Ни голос, ни расшифровка
// никуда не отправляются и не хранятся — см. комментарий в ReadAloudView.tsx.
import { useEffect, useRef, useState } from "react";

/** Минимальный интерфейс Web Speech API — не входит в стандартный DOM lib TypeScript, а вешать
 *  на него внешний @types-пакет ради одного некритичного браузерного API не стоит. */
interface MinimalSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
}

function createSpeechRecognizer(lang: string): MinimalSpeechRecognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => MinimalSpeechRecognition; webkitSpeechRecognition?: new () => MinimalSpeechRecognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.lang = lang;
  recognizer.continuous = true;
  recognizer.interimResults = false;
  return recognizer;
}

/** true, если в этом браузере вообще есть распознавание речи — до записи, чтобы решить, показывать
 *  ли ученику предупреждение о недоступности сверки заранее, а не только после записи. */
export function isSpeechRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export interface VoiceRecorder {
  phase: "idle" | "recording" | "done";
  seconds: number;
  micError: string | null;
  audioUrl: string | null;
  /** null — распознавание недоступно в браузере или запись ещё не завершена; "" — доступно, но ничего не распознано. */
  transcript: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** Возвращает к "idle", отпускает URL предыдущей записи — готов к новой попытке. */
  reset: () => void;
}

export function useVoiceRecorder(lang: string, maxSeconds: number): VoiceRecorder {
  const [phase, setPhase] = useState<VoiceRecorder["phase"]>("idle");
  const [seconds, setSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognizerRef = useRef<MinimalSpeechRecognition | null>(null);
  const transcriptRef = useRef("");

  // счётчик времени записи — считает вверх, автоостановка по maxSeconds
  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= maxSeconds) {
          stop();
          return maxSeconds;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // на выходе со страницы — не оставляем микрофон захваченным
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognizerRef.current?.stop();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;

      transcriptRef.current = "";
      const recognizer = createSpeechRecognizer(lang);
      if (recognizer) {
        recognizer.onresult = (event) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + " ";
          transcriptRef.current = text.trim();
        };
        recognizer.onerror = () => {
          /* распознавание — необязательная часть самопроверки, тихо продолжаем без него */
        };
        try {
          recognizer.start();
          recognizerRef.current = recognizer;
        } catch {
          recognizerRef.current = null;
        }
      }

      setPhase("recording");
    } catch {
      setMicError("Не получилось включить микрофон — проверь, что дал доступ в браузере, и попробуй ещё раз.");
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recognizerRef.current?.stop();
    recognizerRef.current = null;

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setTranscript(isSpeechRecognitionSupported() ? transcriptRef.current : null);
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setPhase("done");
    };
    recorder.stop();
  };

  const reset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setTranscript(null);
    setMicError(null);
    setPhase("idle");
  };

  return { phase, seconds, micError, audioUrl, transcript, start, stop, reset };
}
