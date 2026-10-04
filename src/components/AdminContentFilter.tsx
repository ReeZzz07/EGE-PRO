// Фильтр запрещённых слов и контактов для форм обращений и отзывов (docker/api/contentFilter.js): правила,
// проверка текста «на лету» и журнал срабатываний. Правила действуют сразу после сохранения. Текст, который
// отклонён фильтром, пользователь видит как понятную ошибку формы; в журнале остаётся только короткий фрагмент.
import { useEffect, useState } from "react";
import {
  FILTER_KIND_LABEL, FILTER_RULE_LABEL, FILTER_TARGET_LABEL,
  clearContentFilterLog, loadContentFilter, saveContentFilter, testContentFilter,
  type FilterConfig, type FilterLogItem, type FilterRuleKey, type FilterTarget, type FilterViolation,
} from "../lib/feedback";
import { useToast } from "./ui";

const RULE_KEYS: FilterRuleKey[] = ["words", "phones", "emails", "links", "handles"];
const TARGETS: FilterTarget[] = ["feedback", "reviews"];
const dateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const label = "font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2";

export default function AdminContentFilter() {
  const { push } = useToast();
  const [cfg, setCfg] = useState<FilterConfig | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [defaults, setDefaults] = useState<{ words: string; allow: string; allowedDomains: string } | null>(null);
  const [log, setLog] = useState<FilterLogItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [testText, setTestText] = useState("");
  const [testTarget, setTestTarget] = useState<FilterTarget>("feedback");
  const [testResult, setTestResult] = useState<{ ok: boolean; violations: FilterViolation[]; message: string } | null>(null);

  const load = async () => {
    const r = await loadContentFilter();
    if (!r) return;
    setCfg(r.config);
    setSaved(JSON.stringify(r.config));
    setDefaults(r.defaults);
    setLog(r.log);
  };
  useEffect(() => {
    void load();
  }, []);

  if (!cfg) return <p className="font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;

  const dirty = JSON.stringify(cfg) !== saved;
  const wordsCount = cfg.words.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  const save = async () => {
    setBusy(true);
    const r = await saveContentFilter(cfg);
    setBusy(false);
    if (r.error) return push(r.error, "err");
    setCfg(r.config!);
    setSaved(JSON.stringify(r.config));
    push("Правила фильтра сохранены", "ok");
  };

  const clearLog = async () => {
    if (!window.confirm(`Очистить журнал срабатываний (записей: ${log.length})? Правила фильтра останутся. Это нельзя отменить.`)) return;
    setBusy(true);
    const r = await clearContentFilterLog();
    setBusy(false);
    if (r.error) return push(r.error, "err");
    setLog([]);
    push(`Журнал очищен (удалено записей: ${r.deleted})`, "ok");
  };

  const runTest = async () => {
    setBusy(true);
    const r = await testContentFilter(testText, testTarget, cfg);
    setBusy(false);
    if (r.error) return push(r.error, "err");
    setTestResult({ ok: !!r.ok, violations: r.violations ?? [], message: r.message ?? "" });
  };

  const setRule = (t: FilterTarget, k: FilterRuleKey, v: boolean) => setCfg({ ...cfg, targets: { ...cfg.targets, [t]: { ...cfg.targets[t], [k]: v } } });

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-[13px] leading-relaxed text-ink2">
        Фильтр проверяет текст и подпись в формах <b>обращений</b> и <b>отзывов</b> до сохранения. Если находит запрещённое слово (с производными и обходами:
        «х у й», «xуй», «хуууй») или контакты — телефон, почту, ссылку, @-ник, приглашение в мессенджер, — форма не отправляется, а человек видит понятную подсказку,
        что убрать. Правила действуют сразу после сохранения. Срабатывания записываются в журнал ниже — так вы видите реальные попытки и ложные срабатывания.
      </p>

      <label className="flex items-center gap-2.5 text-[14px] font-bold">
        <input id="cf-enabled" type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="h-4 w-4 accent-blue" />
        Фильтр включён
      </label>

      <div className={`overflow-x-auto border-2 border-ink/15 ${cfg.enabled ? "" : "opacity-50"}`}>
        <table className="w-full min-w-[22rem] text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink/15 text-left">
              <th className={`${label} p-3`}>Что блокировать</th>
              {TARGETS.map((t) => (
                <th key={t} className={`${label} p-3 text-center`}>
                  {FILTER_TARGET_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RULE_KEYS.map((k) => (
              <tr key={k} className="border-b border-ink/10 last:border-0">
                <td className="p-3 font-bold">{FILTER_RULE_LABEL[k]}</td>
                {TARGETS.map((t) => (
                  <td key={t} className="p-3 text-center">
                    <input
                      id={`cf-${t}-${k}`}
                      type="checkbox"
                      aria-label={`${FILTER_RULE_LABEL[k]} — ${FILTER_TARGET_LABEL[t]}`}
                      checked={cfg.targets[t][k]}
                      onChange={(e) => setRule(t, k, e.target.checked)}
                      className="h-4 w-4 accent-blue"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <label htmlFor="cf-words" className={label}>
          Запрещённые слова ({wordsCount})
        </label>
        <textarea id="cf-words" value={cfg.words} onChange={(e) => setCfg({ ...cfg, words: e.target.value })} rows={16} spellCheck={false} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 font-mono text-[12.5px] leading-relaxed" />
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink2">
          По одному в строке. <code className="font-mono">слово</code> — основа: ловит само слово, любые окончания и до двух приставок (за-, по-, вы-, раз- …).{" "}
          <code className="font-mono">=слово</code> — только это слово целиком (для коротких слов, чтобы не задеть «Херсон»).{" "}
          <code className="font-mono">~фраза из слов</code> — фраза целиком. Строки с <code className="font-mono">#</code> — комментарии. Латиница и транслит пишутся так же.
        </p>
        {defaults && (
          <button type="button" onClick={() => setCfg({ ...cfg, words: defaults.words })} className="link-slide mt-1 text-[12.5px] font-bold text-ink2 hover:text-ink">
            Вернуть стандартный список
          </button>
        )}
      </div>

      <div>
        <label htmlFor="cf-allow" className={label}>
          Исключения (никогда не считаются запрещёнными)
        </label>
        <textarea id="cf-allow" value={cfg.allow} onChange={(e) => setCfg({ ...cfg, allow: e.target.value })} rows={4} spellCheck={false} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 font-mono text-[12.5px]" />
        <p className="mt-1 text-[12px] text-ink2">
          <code className="font-mono">слово</code> — точно это слово, <code className="font-mono">слово*</code> — с любым окончанием. Сюда добавляйте слова, на которые фильтр срабатывает зря (смотрите журнал).
        </p>
      </div>

      <div>
        <label htmlFor="cf-domains" className={label}>
          Разрешённые домены для ссылок
        </label>
        <input id="cf-domains" value={cfg.allowedDomains} onChange={(e) => setCfg({ ...cfg, allowedDomains: e.target.value })} placeholder="ege-tutor.ru" className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]" />
        <p className="mt-1 text-[12px] text-ink2">Через запятую. Ссылки на эти сайты (и их поддомены) не блокируются, например ссылка на страницу вашего сайта в обращении.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy || !dirty} className="btn btn-ink px-5 py-2.5 text-[13px] disabled:opacity-40">
          {busy ? "Сохраняем…" : "Сохранить правила"}
        </button>
        {dirty && <span className="font-mono text-[11.5px] text-amber">есть несохранённые изменения</span>}
      </div>

      {/* проверка текста */}
      <section className="border-2 border-ink/15 p-4" aria-labelledby="cf-test-title">
        <h3 id="cf-test-title" className="font-display text-[15px] font-black">
          Проверить текст
        </h3>
        <p className="mt-1 text-[12.5px] text-ink2">Проверка идёт по правилам из формы выше — даже несохранённым, так можно подобрать список, не рискуя пропустить лишнее.</p>
        <textarea id="cf-test-text" aria-label="Текст для проверки" value={testText} onChange={(e) => setTestText(e.target.value)} rows={3} maxLength={5000} placeholder="Вставьте текст сообщения или отзыва" className="input-blank mt-2 w-full resize-y rounded-sm px-3 py-2 text-[13px]" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select id="cf-test-target" aria-label="Форма" value={testTarget} onChange={(e) => setTestTarget(e.target.value as FilterTarget)} className="input-blank rounded-sm px-2.5 py-2 text-[13px]">
            {TARGETS.map((t) => (
              <option key={t} value={t}>
                Как в форме: {FILTER_TARGET_LABEL[t].toLowerCase()}
              </option>
            ))}
          </select>
          <button onClick={runTest} disabled={busy || !testText.trim()} className="btn btn-ghost px-4 py-2 text-[12.5px] disabled:opacity-40">
            Проверить
          </button>
        </div>
        {testResult && (
          <div role="status" className={`mt-3 border-l-4 px-3 py-2.5 text-[13px] ${testResult.ok ? "border-green bg-green/10" : "border-red bg-red/10"}`}>
            {testResult.ok ? (
              <p className="font-bold">Текст проходит фильтр.</p>
            ) : (
              <>
                <p className="font-bold">Текст будет отклонён. Найдено:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {testResult.violations.map((v, i) => (
                    <li key={i}>
                      {FILTER_KIND_LABEL[v.kind]}: <code className="font-mono">{v.match}</code>
                      {v.rule && v.rule !== v.match && <span className="text-ink2"> (правило «{v.rule}»)</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-ink2">Пользователь увидит: «{testResult.message}»</p>
              </>
            )}
          </div>
        )}
      </section>

      {/* журнал */}
      <section aria-labelledby="cf-log-title">
        <div className="flex items-center justify-between gap-3">
          <h3 id="cf-log-title" className="font-display text-[15px] font-black">
            Журнал срабатываний
          </h3>
          <div className="flex items-center gap-4">
            <button onClick={() => void load()} className="link-slide text-[12.5px] font-bold text-ink2 hover:text-ink">
              Обновить
            </button>
            <button onClick={clearLog} disabled={busy || log.length === 0} className="btn btn-ghost px-3 py-1.5 text-[12px] text-red disabled:opacity-40">
              Очистить журнал
            </button>
          </div>
        </div>
        <p className="mt-1 text-[12.5px] text-ink2">Последние 100 отклонённых текстов (хранятся 90 дней, только короткий фрагмент). Если здесь обычный текст — добавьте слово в исключения.</p>
        {log.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink2">Пока ничего не блокировалось.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {log.map((l) => (
              <li key={l.id} className="border-2 border-ink/15 px-3 py-2">
                <p className="font-mono text-[11px] text-ink2">
                  {dateTime(l.createdAt)} · {FILTER_TARGET_LABEL[l.target]} · поле «{l.field}» · {l.reasons.map((r) => FILTER_KIND_LABEL[r as FilterViolation["kind"]] ?? r).join(", ")}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px]">{l.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
