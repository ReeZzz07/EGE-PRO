// Письма-напоминания, которые уходят сами (docker/api/lifecycle.js): напоминание тем, кто не начал
// заниматься, брошенная оплата, скорое окончание и окончание платного тарифа. Редактируется тема и текст;
// оформление (шапка, рамки, нумерованные пункты, карточка состава продления, кнопка) — то же, что у
// приветственного письма, и зашито в код. Предпросмотр показывает письмо ровно так, как оно уйдёт.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  loadLifecycleTemplates,
  previewLifecycleTemplate,
  saveLifecycleTemplate,
  sendTestLifecycleEmail,
  type LifecycleKind,
  type LifecycleTemplate,
} from "../lib/lifecycleEmails";
import { Icon, useToast } from "./ui";

export default function AdminLifecycleEmails() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [templates, setTemplates] = useState<LifecycleTemplate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; bodyText: string }>>({});
  const [active, setActive] = useState<LifecycleKind>("activation");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadLifecycleTemplates().then((res) => {
      if (res.error || !res.templates) return setLoadError(res.error ?? "Не удалось загрузить письма");
      setTemplates(res.templates);
      setDrafts(Object.fromEntries(res.templates.map((t) => [t.kind, { ...t.current }])));
    });
  }, []);

  const tpl = templates.find((t) => t.kind === active);
  const draft = drafts[active];

  const refreshPreview = useCallback(
    async (kind: LifecycleKind, d: { subject: string; bodyText: string }) => {
      setPreviewing(true);
      const res = await previewLifecycleTemplate(kind, d.subject, d.bodyText);
      setPreviewing(false);
      if (res.error) return push(res.error, "err");
      setPreviewHtml(res.html ?? null);
      setPreviewSubject(res.subject ?? "");
    },
    [push]
  );

  // при переключении письма сразу показываем предпросмотр сохранённого текста
  useEffect(() => {
    const d = drafts[active];
    if (d) refreshPreview(active, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, templates.length]);

  if (loadError) {
    return (
      <div className="sheet p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold">Письма-напоминания</h2>
        <p className="mt-3 text-[13px] font-bold text-red">{loadError}</p>
      </div>
    );
  }
  if (!tpl || !draft) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  const setDraft = (patch: Partial<{ subject: string; bodyText: string }>) => setDrafts((d) => ({ ...d, [active]: { ...d[active], ...patch } }));
  const dirty = draft.subject !== tpl.current.subject || draft.bodyText !== tpl.current.bodyText;
  const isDefault = draft.subject === tpl.defaults.subject && draft.bodyText === tpl.defaults.bodyText;

  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) return setDraft({ bodyText: draft.bodyText + token });
    const start = el.selectionStart ?? draft.bodyText.length;
    const end = el.selectionEnd ?? start;
    setDraft({ bodyText: draft.bodyText.slice(0, start) + token + draft.bodyText.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!draft.subject.trim() || !draft.bodyText.trim()) return push("Заполни тему и текст письма", "err");
    setSaving(true);
    const res = await saveLifecycleTemplate(active, draft.subject, draft.bodyText);
    setSaving(false);
    if (res.error) return push(res.error, "err");
    setTemplates((ts) => ts.map((t) => (t.kind === active ? { ...t, current: { ...draft } } : t)));
    push("Сохранено — следующие письма этого вида уйдут с новым текстом", "ok");
  };

  const sendTest = async () => {
    setTesting(true);
    const res = await sendTestLifecycleEmail(active, draft.subject, draft.bodyText);
    setTesting(false);
    if (res.error) push(res.error, "err");
    else push(`Тестовое письмо ушло на ${profile?.email}`, "ok");
  };

  return (
    <div className="sheet mt-6 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Письма-напоминания</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
        Уходят автоматически, по одному разу на человека, с 9:00 до 21:00 по Москве. Оформление (шапка, рамки, нумерованные пункты, кнопка) — как у приветственного письма,
        редактируется только тема и текст. Пустая строка в тексте — новый абзац. Подстановки в фигурных скобках заменяются данными ученика; абзац, где для подстановки нет
        значения, в письмо не попадёт.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {templates.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={t.kind === active}
            onClick={() => setActive(t.kind)}
            className={`border-2 px-3 py-1.5 text-[12.5px] font-bold transition ${t.kind === active ? "border-ink bg-ink text-paper" : "border-ink/20 bg-paper hover:border-ink/50"}`}
          >
            {t.title}
          </button>
        ))}
      </div>

      <p className="mt-3 border-l-4 border-blue bg-blue/8 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">
        <strong className="text-ink">Когда уходит:</strong> {tpl.when}
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тема письма</span>
            <input value={draft.subject} onChange={(e) => setDraft({ subject: e.target.value })} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
              Текст письма
              {tpl.kind === "activation" && (
                <span className="font-normal normal-case"> (первый и последний абзац — обычным текстом, между ними — пронумерованные пункты)</span>
              )}
            </span>
            <textarea
              ref={bodyRef}
              value={draft.bodyText}
              onChange={(e) => setDraft({ bodyText: e.target.value })}
              rows={13}
              className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
            />
          </label>
          {tpl.placeholders.length > 0 && (
            <div>
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Подстановки — нажми, чтобы вставить в текст</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tpl.placeholders.map((p) => (
                  <button key={p} onClick={() => insert(p)} className="rounded-sm border border-ink/25 bg-sheet px-2 py-1 font-mono text-[12px] hover:border-ink/60">
                    {`{${p}}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={saving || !dirty} className="btn btn-blue px-5 py-2.5 text-[13px]">
              <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
            </button>
            <button onClick={() => refreshPreview(active, draft)} disabled={previewing} className="btn btn-ghost px-4 py-2.5 text-[13px]">
              <Icon name="eye" size={14} /> {previewing ? "Обновляем…" : "Обновить предпросмотр"}
            </button>
            <button onClick={sendTest} disabled={testing} className="btn btn-ghost px-4 py-2.5 text-[13px]">
              <Icon name="send" size={14} /> {testing ? "Отправляем…" : `Тестовое на ${profile?.email ?? "мою почту"}`}
            </button>
            <button onClick={() => setDraft({ ...tpl.defaults })} disabled={isDefault} className="btn btn-ghost px-4 py-2.5 text-[13px]">
              <Icon name="refresh" size={14} /> К дефолту
            </button>
          </div>
          {dirty && <p className="font-mono text-[11.5px] text-amber">Есть несохранённые изменения — предпросмотр и тестовое письмо показывают текст из формы.</p>}
        </div>

        <div>
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Как выглядит письмо (образцовые данные)</span>
          {previewSubject && (
            <p className="mt-1.5 text-[12.5px] text-ink2">
              Тема: <strong className="text-ink">{previewSubject}</strong>
            </p>
          )}
          <div className="mt-1.5 overflow-hidden border-2 border-ink/20 bg-white">
            {previewHtml ? (
              <iframe title="Предпросмотр письма" srcDoc={previewHtml} sandbox="" className="h-[640px] w-full border-0" />
            ) : (
              <p className="p-6 text-center text-[13px] text-ink2">{previewing ? "Строим предпросмотр…" : "Предпросмотр появится здесь"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
