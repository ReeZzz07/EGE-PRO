// Шкала перевода первичных баллов в тестовые (public.score_scales) — комиссия Рособрнадзора
// утверждает её заново каждый год по каждому предмету, поэтому это не статичные данные в коде,
// а таблица, которую админ обновляет здесь при появлении новой официальной шкалы. Ввод — не
// построчная форма на 30-80 полей, а один textarea: вставляешь пары "первичный вторичный" целиком
// (из таблицы ФИПИ/Рособрнадзора), сохраняешь — все прежние строки года заменяются новыми.
import { useEffect, useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { ALL_SUBJECTS } from "../lib/dbTasks";
import { deleteScoreScale, isGradeSubject, listScoreScaleYears, loadScoreScale, saveScoreScale, type ScorePoint } from "../lib/scoreScale";
import { Icon, useToast } from "./ui";

function parseRows(text: string): { rows: ScorePoint[]; errors: string[] } {
  const rows: ScorePoint[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  text.split("\n").forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const m = line.match(/^(\d+)\D+(\d+)$/);
    if (!m) {
      errors.push(`строка ${i + 1}: не разобрана — «${line}»`);
      return;
    }
    const primary = Number(m[1]);
    const secondary = Number(m[2]);
    if (seen.has(primary)) {
      errors.push(`строка ${i + 1}: первичный балл ${primary} повторяется`);
      return;
    }
    seen.add(primary);
    rows.push({ primary, secondary });
  });
  return { rows: rows.sort((a, b) => a.primary - b.primary), errors };
}

function rowsToText(rows: ScorePoint[]): string {
  return rows.map((r) => `${r.primary}\t${r.secondary}`).join("\n");
}

export default function AdminScoreScales() {
  const { push } = useToast();
  const [subject, setSubject] = useState<Subject>("rus");
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadYears = async (s: Subject) => {
    const ys = await listScoreScaleYears(s);
    setYears(ys);
    return ys;
  };

  useEffect(() => {
    setLoading(true);
    loadYears(subject).then((ys) => {
      const targetYear = ys[0] ?? new Date().getFullYear();
      setYear(targetYear);
      if (ys.length) {
        loadScoreScale(subject, targetYear).then((rows) => {
          setText(rowsToText(rows));
          setLoading(false);
        });
      } else {
        setText("");
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const openYear = async (y: number) => {
    setYear(y);
    setLoading(true);
    const rows = await loadScoreScale(subject, y);
    setText(rowsToText(rows));
    setLoading(false);
  };

  const startNewYear = () => {
    const suggested = (years[0] ?? new Date().getFullYear() - 1) + 1;
    setYear(suggested);
    setText("");
  };

  const { rows, errors } = parseRows(text);
  const maxPrimary = rows.length ? rows[rows.length - 1].primary : null;

  const save = async () => {
    if (errors.length) return push("Сначала исправь ошибки в списке — есть нераспознанные строки", "err");
    if (!rows.length) return push("Список пуст — нечего сохранять", "err");
    setSaving(true);
    const res = await saveScoreScale(subject, year, rows);
    setSaving(false);
    if (res.error) return push(res.error, "err");
    push(`Шкала ${SUBJECTS[subject].name} за ${year} год сохранена (${rows.length} строк)`, "ok");
    loadYears(subject);
  };

  const removeYear = async (y: number) => {
    const res = await deleteScoreScale(subject, y);
    if (res.error) return push(res.error, "err");
    push(`Шкала за ${y} год удалена`, "ok");
    const ys = await loadYears(subject);
    if (y === year) {
      if (ys.length) openYear(ys[0]);
      else {
        setText("");
        setYear(new Date().getFullYear());
      }
    }
  };

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Шкала перевода баллов</h2>
          <p className="mt-1 max-w-lg text-[12.5px] text-ink2">
            Первичные → тестовые баллы. Комиссия Рособрнадзора утверждает новую шкалу каждый год отдельно по каждому
            предмету (обычно весной, после досрочного этапа) — обновляй здесь, когда выйдет официальная таблица.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[200px_1fr]">
        {/* предметы */}
        <div className="flex flex-row flex-wrap gap-1.5 sm:flex-col">
          {ALL_SUBJECTS.map((s) => (
            <button
              key={s}
              onClick={() => setSubject(s)}
              className={`flex items-center gap-2 rounded-sm border-2 px-2.5 py-2 text-left text-[12.5px] font-bold transition ${
                subject === s ? "border-blue bg-blue/8 text-blue" : "border-ink/10 text-ink2 hover:border-ink/30 hover:text-ink"
              }`}
            >
              <span className={`font-mono text-[10px] ${SUBJECTS[s].color}`}>{SUBJECTS[s].short}</span>
              {SUBJECTS[s].name}
            </button>
          ))}
        </div>

        {/* редактор */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Год:</span>
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => openYear(y)}
                  className={`group flex items-center gap-1.5 rounded-sm border-2 px-2 py-1 font-mono text-[12px] font-bold ${
                    y === year ? "border-ink bg-hl" : "border-ink/15 text-ink2 hover:border-ink/40"
                  }`}
                >
                  {y}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeYear(y);
                    }}
                    className="text-ink2 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red"
                    title="Удалить шкалу за этот год"
                  >
                    <Icon name="x" size={11} />
                  </span>
                </button>
              ))}
              <button onClick={startNewYear} className="btn btn-ghost px-2 py-1 text-[12px]">
                <Icon name="spark" size={12} /> Новый год
              </button>
            </div>
            <label className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-ink2">
              за
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="input-blank w-20 rounded-sm px-2 py-1 text-center text-[12.5px]"
              />
              год
            </label>
          </div>

          {isGradeSubject(subject) && (
            <p className="mt-2 border-l-4 border-amber bg-amber/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
              Базовая математика не переводится в 100-балльную шкалу — вторичное число здесь означает <strong className="text-ink">школьную оценку (2-5)</strong>,
              а не тестовый балл.
            </p>
          )}

          {loading ? (
            <p className="mt-4 font-mono text-[12px] text-ink2">Загрузка…</p>
          ) : (
            <>
              <label className="mt-3 block">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
                  Первичный → {isGradeSubject(subject) ? "оценка" : "тестовый"}, по одной паре в строке
                </span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  placeholder={"0\t0\n1\t3\n2\t5\n…"}
                  className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 font-mono text-[12.5px] leading-relaxed"
                />
              </label>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-ink2">
                <span>
                  распознано <strong className="text-ink">{rows.length}</strong> {maxPrimary !== null && <>(0…{maxPrimary} первичных)</>}
                </span>
                {errors.length > 0 && <span className="font-bold text-red">{errors.length} ошибок разбора</span>}
              </div>

              {errors.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-red">
                  {errors.slice(0, 6).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {errors.length > 6 && <li>…и ещё {errors.length - 6}</li>}
                </ul>
              )}

              <button onClick={save} disabled={saving} className="btn btn-blue mt-4 px-5 py-2.5 text-sm">
                {saving ? "Сохраняем…" : "Сохранить шкалу"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
