// Публичная страница документа (оферта/политика конфиденциальности) — доступна и гостям (ссылки
// ведут сюда со страницы регистрации и со страницы тарифов, до входа в аккаунт). Текст редактирует
// админ в AdminLegalDocs.tsx; здесь — только отображение + печать + скачивание PDF.
import { useEffect, useState } from "react";
import { loadLegalDoc, LEGAL_DOC_LABELS, LEGAL_SEO, type LegalDocKey, type LegalDoc as LegalDocData } from "../lib/legal";
import { downloadTextAsPdf } from "../lib/pdfExport";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

export default function LegalDoc({ doc, onNav }: { doc: LegalDocKey; onNav: (v: View) => void }) {
  const { push } = useToast();
  const [data, setData] = useState<LegalDocData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    loadLegalDoc(doc).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [doc]);

  // фиксированные заголовки, без формы в админке, и noindex — эти страницы не рассчитаны на
  // трафик из поиска (см. lib/seo.ts)
  useDocumentHead({ ...LEGAL_SEO[doc], path: doc === "offer" ? "/oferta" : "/privacy", noindex: true });

  const downloadPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await downloadTextAsPdf(data.title, data.content, `${doc === "offer" ? "oferta" : "politika-konfidencialnosti"}.pdf`);
    } catch {
      push("Не получилось собрать PDF — попробуй ещё раз или воспользуйся печатью", "err");
    }
    setExporting(false);
  };

  if (loading || !data) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <div className="no-print mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LEGAL_DOC_LABELS) as LegalDocKey[]).map((k) => (
            <button
              key={k}
              onClick={() => onNav({ name: "legal", doc: k })}
              className={`rounded-sm border-2 px-3.5 py-2 text-[12.5px] font-bold transition ${
                k === doc ? "border-blue bg-blue/10 text-blue" : "border-ink/15 text-ink2 hover:border-ink/35 hover:text-ink"
              }`}
            >
              {LEGAL_DOC_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
            <Icon name="print" size={14} /> Печать
          </button>
          <button onClick={downloadPdf} disabled={exporting} className="btn btn-ghost px-3.5 py-2 text-[12.5px] disabled:opacity-50">
            <Icon name="download" size={14} /> {exporting ? "Собираем…" : "Скачать PDF"}
          </button>
        </div>
      </div>

      <div className="legal-doc-print sheet mt-5 p-6 sm:p-8">
        <h1 className="font-display text-xl font-bold sm:text-2xl">{data.title}</h1>
        {data.updatedAt && (
          <p className="mt-1.5 font-mono text-[11.5px] text-ink2">Обновлено: {new Date(data.updatedAt).toLocaleDateString("ru-RU")}</p>
        )}
        <div className="mt-6 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/90">{data.content}</div>
      </div>
    </div>
  );
}
