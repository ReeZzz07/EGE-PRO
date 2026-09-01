import { useEffect, useState } from "react";
import { SUBJECTS } from "../data/tasks";
import {
  loadTaskSubjectStats,
  loadTasks,
  updateTask,
  deleteTaskMedia,
  uploadTaskMedia,
  mediaPublicUrl,
  type AdminTaskRow,
  type SubjectStat,
} from "../lib/adminTasks";
import { Icon, useToast } from "./ui";

const PAGE_SIZE = 10;

function subjectLabel(s: string): string {
  return (SUBJECTS as Record<string, { name: string }>)[s]?.name ?? s;
}

function TaskCard({ row, onChanged }: { row: AdminTaskRow; onChanged: () => void }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(row.topic);
  const [statement, setStatement] = useState(row.statement);
  const [answer, setAnswer] = useState(row.answer ?? "");
  const [explanation, setExplanation] = useState(row.explanation ?? "");
  const [saving, setSaving] = useState(false);
  const [media, setMedia] = useState(row.task_media);

  const save = async (extra?: Partial<Pick<AdminTaskRow, "published" | "needs_review">>) => {
    setSaving(true);
    const res = await updateTask(row.id, { topic, statement, answer: answer || null, explanation: explanation || null, ...extra });
    setSaving(false);
    if (res.error) push(res.error, "err");
    else {
      push(extra?.published ? "Опубликовано" : extra?.published === false ? "Возвращено на проверку" : "Сохранено", "ok");
      onChanged();
    }
  };

  const removeMedia = async (m: AdminTaskRow["task_media"][number]) => {
    const res = await deleteTaskMedia(m.id, m.storage_path);
    if (res.error) push(res.error, "err");
    else setMedia((cur) => cur.filter((x) => x.id !== m.id));
  };

  const uploadMedia = async (file: File) => {
    const res = await uploadTaskMedia(row.id, file);
    if (res.error) push(res.error, "err");
    else {
      push("Картинка загружена", "ok");
      onChanged();
      setOpen(false);
      setTimeout(() => setOpen(true), 0); // перечитать media при следующем открытии списка проще, чем городить локальный рефетч одной карточки
    }
  };

  return (
    <div className="border-2 border-dashed border-ink/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-bold text-ink2">{row.id}</span>
            <span className="rounded-sm border border-ink/25 px-1.5 py-0.5 font-mono text-[10.5px] text-ink2">{row.bucket === "essay" ? "развёрнутый" : "краткий"}</span>
            {row.confidence && <span className="rounded-sm border border-ink/25 px-1.5 py-0.5 font-mono text-[10.5px] text-ink2">{row.confidence}</span>}
            <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${row.published ? "bg-green/15 text-green" : "bg-amber/15 text-amber"}`}>
              {row.published ? "опубликовано" : "на проверке"}
            </span>
          </div>
          <p className="mt-1.5 truncate text-[13.5px] font-semibold text-ink">{row.topic}</p>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-[12.5px] text-ink2">{row.statement}</p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost shrink-0 px-3 py-1.5 text-[12px]">
          {open ? "Свернуть" : "Открыть"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t-2 border-dashed border-ink/15 pt-4">
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тема</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]" />
          </label>
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Условие</span>
            <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={6} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]" />
          </label>

          {media.length > 0 && (
            <div>
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Картинки</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {media.map((m) => (
                  <div key={m.id} className="relative">
                    <img src={mediaPublicUrl(m.storage_path)} alt="" className="h-24 w-24 rounded-sm border-2 border-ink/15 object-cover" />
                    <button onClick={() => removeMedia(m)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red text-white">
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Добавить картинку</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMedia(f);
                e.target.value = "";
              }}
              className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[12.5px]"
            />
          </label>

          {row.bucket === "auto" ? (
            <>
              <label className="block">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Верный ответ</span>
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px] font-mono" />
              </label>
              <label className="block">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Объяснение (разбор для ученика)</span>
                <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={5} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]" />
              </label>
            </>
          ) : (
            <p className="text-[12.5px] text-ink2">Развёрнутый ответ — критерии оценивания редактируются только текстом условия выше, эталонного ответа нет по типу задания.</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => save()} disabled={saving} className="btn btn-ghost px-4 py-2 text-[12.5px]">
              <Icon name="check" size={14} /> Сохранить
            </button>
            {row.published ? (
              <button onClick={() => save({ published: false, needs_review: true })} disabled={saving} className="btn btn-ghost px-4 py-2 text-[12.5px]">
                Снять с публикации
              </button>
            ) : (
              <button onClick={() => save({ published: true, needs_review: false })} disabled={saving} className="btn btn-blue px-4 py-2 text-[12.5px]">
                <Icon name="eye" size={14} /> Опубликовать
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminTaskReview() {
  const [stats, setStats] = useState<SubjectStat[]>([]);
  const [subject, setSubject] = useState<string>("");
  const [onlyReview, setOnlyReview] = useState(true);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminTaskRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadTasks({ subject: subject || undefined, onlyReview, page, pageSize: PAGE_SIZE }).then(({ rows, total }) => {
      setRows(rows);
      setTotal(total);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadTaskSubjectStats().then(setStats);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, onlyReview, page]);

  useEffect(() => {
    setPage(0);
  }, [subject, onlyReview]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Импортированные задания</h2>
          <p className="mt-1 text-[12.5px] text-ink2">Массово решённый банк ФИПИ — правь текст/ответ/картинки и публикуй, когда уверен(а).</p>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {stats.map((s) => (
            <span key={s.subject} className="rounded-sm border border-ink/20 px-2.5 py-1 font-mono text-[11px] text-ink2">
              {subjectLabel(s.subject)}: {s.published} опубл. / {s.needsReview} на проверке
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t-2 border-dashed border-ink/15 pt-4">
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="input-blank rounded-sm px-3 py-2 text-[13px]">
          <option value="">Все предметы</option>
          {stats.map((s) => (
            <option key={s.subject} value={s.subject}>
              {subjectLabel(s.subject)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink2">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          только на проверке
        </label>
        <span className="ml-auto font-mono text-[12px] text-ink2">
          {total} заданий · стр. {page + 1}/{totalPages}
        </span>
        <div className="flex gap-1.5">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-ghost px-3 py-1.5 text-[12px]">
            <Icon name="arrowL" size={14} />
          </button>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn btn-ghost px-3 py-1.5 text-[12px]">
            <Icon name="arrowR" size={14} />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink2">Ничего не найдено — либо всё опубликовано, либо ещё не импортировано.</p>
        ) : (
          rows.map((row) => <TaskCard key={row.id} row={row} onChanged={refresh} />)
        )}
      </div>
    </div>
  );
}
