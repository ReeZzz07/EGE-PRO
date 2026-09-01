// Редактирование текста публичной оферты и политики конфиденциальности — public.legal_documents
// (см. supabase/migrations/0012_legal_documents.sql). Показывается на публичной странице LegalDoc.tsx.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { loadAllLegalDocs, saveLegalDoc, LEGAL_DOC_LABELS, type LegalDoc, type LegalDocKey } from "../lib/legal";
import { Icon, useToast } from "./ui";

export default function AdminLegalDocs() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<Record<LegalDocKey, LegalDoc> | null>(null);
  const [active, setActive] = useState<LegalDocKey>("offer");

  useEffect(() => {
    loadAllLegalDocs().then((list) => {
      const byKey = Object.fromEntries(list.map((d) => [d.key, d])) as Record<LegalDocKey, LegalDoc>;
      setDocs(byKey);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile || !docs) return;
    setSaving(true);
    const res = await saveLegalDoc(active, { title: docs[active].title, content: docs[active].content }, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новая редакция сразу видна на публичной странице документа", "ok");
  };

  if (loading || !docs) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  const doc = docs[active];

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Юридические документы</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Показываются на публичной странице — ссылки на неё ведут со страницы регистрации и со страницы тарифов. Текст можно печатать и скачивать как PDF прямо со страницы.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <div className="mt-5 flex gap-2 border-b-2 border-ink/15 pb-px">
        {(Object.keys(LEGAL_DOC_LABELS) as LegalDocKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setActive(k)}
            className={`px-4 py-2.5 text-[13px] font-bold transition ${active === k ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
          >
            {LEGAL_DOC_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Заголовок</span>
          <input
            value={doc.title}
            onChange={(e) => setDocs({ ...docs, [active]: { ...doc, title: e.target.value } })}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Текст документа <span className="font-normal normal-case">(пустая строка — разделитель между абзацами, форматирование — обычным текстом)</span>
          </span>
          <textarea
            value={doc.content}
            onChange={(e) => setDocs({ ...docs, [active]: { ...doc, content: e.target.value } })}
            rows={22}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
          />
        </label>
        {doc.updatedAt && (
          <p className="font-mono text-[11px] text-ink2">Последнее изменение: {new Date(doc.updatedAt).toLocaleString("ru-RU")}</p>
        )}
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-5 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}
