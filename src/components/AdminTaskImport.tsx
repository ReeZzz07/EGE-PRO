import { useRef, useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { importArchive, type ImportArchiveResult } from "../lib/adminTasks";
import { isSupabaseConfigured } from "../lib/supabase";
import { Icon, useToast } from "./ui";

export default function AdminTaskImport() {
  const { push } = useToast();
  const [subject, setSubject] = useState<Subject>("inf");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportArchiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await importArchive(file, subject);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      push("Импорт не удался — см. подробности ниже", "err");
    } else if (res.data) {
      setResult(res.data);
      push(`Импортировано ${res.data.tasksOk} из ${res.data.tasksTotal} заданий`, res.data.tasksFailed ? "err" : "ok");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Импорт из архива</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Загрузи ZIP с заданиями по одному предмету — свои наборы (когда найдёшь данные для информатики, например) или доразметка того, что не покрыл автоимпорт.
        Не требует терминала — всё через эту форму.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> загрузка не сработает — это только предпросмотр формы.
        </p>
      )}

      <button onClick={() => setShowFormat((v) => !v)} className="link-slide mt-4 flex items-center gap-1.5 text-[12.5px] font-bold text-ink2 hover:text-ink">
        <Icon name="arrowR" size={14} className={`transition-transform ${showFormat ? "rotate-90" : ""}`} /> Формат архива
      </button>
      {showFormat && (
        <div className="mt-2 space-y-2 border-l-4 border-blue/40 bg-blue/5 px-4 py-3 text-[12.5px] leading-relaxed text-ink2">
          <p>
            В корне ZIP — файл <code className="rounded-sm bg-ink/10 px-1">tasks.json</code> (массив) или{" "}
            <code className="rounded-sm bg-ink/10 px-1">tasks.jsonl</code> (по объекту на строку). Картинки — любые файлы в архиве, задание ссылается на них по пути.
          </p>
          <p>Поля одного задания (все, кроме statement, необязательны):</p>
          <pre className="overflow-x-auto rounded-sm bg-ink/10 p-2.5 font-mono text-[11px] leading-relaxed">
{`{
  "id": "своя-строка",           // иначе сгенерируется
  "topic": "Тема",
  "statement": "Условие…",       // или ["строка 1", "строка 2"]
  "answer": "42",                // для краткого ответа
  "explanation": "Разбор…",
  "hints": ["1", "2", "3"],      // необязательно — иначе сгенерируется из explanation
  "points": 2,
  "ege_number": 5,
  "bucket": "auto",              // "auto" | "essay"
  "criteria": [{"code":"К1","name":"…","max":2}],  // для bucket:"essay"
  "images": ["pic1.png"]         // пути картинок внутри архива
}`}
          </pre>
          <p>
            Также понимает формат агрегатора NeoFamily (поле <code className="rounded-sm bg-ink/10 px-1">question_html</code>/<code className="rounded-sm bg-ink/10 px-1">answer_html</code>) —
            определяется автоматически, отдельно готовить не нужно.
          </p>
          <p>Задания без распознанного ответа/критериев попадают со статусом «на проверке» — донастроить можно во вкладке «Задания на проверке».</p>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Предмет</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value as Subject)} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[13px]">
            {Object.values(SUBJECTS).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Архив (.zip)</span>
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input-blank mt-1.5 block w-full rounded-sm px-3.5 py-2.5 text-[13px] file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[12px] file:font-bold file:text-paper"
          />
        </label>
      </div>

      <button onClick={submit} disabled={!file || busy} className="btn btn-blue mt-5 px-5 py-2.5 text-[13px]">
        {busy ? <><Icon name="refresh" size={14} className="animate-spin" /> Импортируем…</> : <><Icon name="send" size={14} /> Загрузить и импортировать</>}
      </button>

      {error && (
        <p className="anim-rise mt-4 flex items-start gap-2 border-l-4 border-red bg-red/8 px-4 py-3 text-[13px] leading-relaxed text-ink">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-red" /> {error}
        </p>
      )}

      {result && (
        <div className="anim-rise mt-5 border-2 border-ink/15 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Всего в архиве", result.tasksTotal],
              ["Импортировано", result.tasksOk],
              ["Опубликовано", result.published],
              ["На проверке", result.needsReview],
            ].map(([l, v]) => (
              <div key={l as string}>
                <div className="font-display text-xl font-black">{v}</div>
                <div className="text-[11px] font-semibold text-ink2">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink2">Медиа загружено: {result.mediaOk}{result.mediaFailed ? `, ошибок медиа: ${result.mediaFailed}` : ""}</p>
          {result.errors.length > 0 && (
            <div className="mt-3 border-t border-dashed border-ink/20 pt-3">
              <p className="text-[12px] font-bold text-red">Ошибки ({result.errors.length}{result.errors.length >= 50 ? "+, показаны первые 50" : ""}):</p>
              <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-ink2">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
