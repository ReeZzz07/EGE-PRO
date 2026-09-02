// Заголовки/описания публичных страниц + картинка для соцсетей — public.content_blocks (ключ
// "seo", тот же паттерн, что и остальной контент лендинга). Применяются на лету через
// lib/useDocumentHead.ts на каждой из четырёх публичных страниц (см. lib/routes.ts).
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { DEFAULT_SEO, loadSeoSettings, saveSeoSettings, SEO_PAGE_LABELS, SITE_URL_PLACEHOLDER, type SeoPageKey, type SeoSettings } from "../lib/seo";
import { Icon, useToast } from "./ui";

const PAGE_PATH: Record<SeoPageKey, string> = { home: "/", tariffs: "/tariffs", offer: "/oferta", privacy: "/privacy" };

export default function AdminSeoSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seo, setSeo] = useState<SeoSettings>(DEFAULT_SEO);

  useEffect(() => {
    loadSeoSettings().then((s) => {
      setSeo(s);
      setLoading(false);
    });
  }, []);

  const setPage = (key: SeoPageKey, patch: Partial<SeoSettings["pages"][SeoPageKey]>) => {
    setSeo((s) => ({ ...s, pages: { ...s.pages, [key]: { ...s.pages[key], ...patch } } }));
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveSeoSettings(seo, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — заголовки применятся при следующем открытии страницы", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">SEO</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Заголовок вкладки браузера, описание для поисковика и превью для соцсетей — по одной публичной странице за раз. Применяется только к
        четырём страницам с настоящим адресом (главная, тарифы, оферта, политика) — у остального приложения своих URL нет.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
        <strong className="text-ink">Домен пока не настроен:</strong> в canonical-ссылках, robots.txt и sitemap.xml стоит заглушка{" "}
        <code className="font-mono">{SITE_URL_PLACEHOLDER}</code>. Когда появится реальный домен, задай его переменной{" "}
        <code className="font-mono">VITE_SITE_URL</code> при сборке — здесь его редактировать не получится, эти файлы статические.
      </p>

      <div className="mt-5">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Картинка для превью в соцсетях (og:image) <span className="font-normal normal-case">— полная ссылка на изображение, необязательно</span>
          </span>
          <input
            value={seo.ogImage}
            onChange={(e) => setSeo((s) => ({ ...s, ogImage: e.target.value }))}
            placeholder="https://…/preview.png"
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[12.5px]"
          />
        </label>
      </div>

      <div className="mt-6 space-y-4">
        {(Object.keys(SEO_PAGE_LABELS) as SeoPageKey[]).map((key) => (
          <div key={key} className="border-2 border-dashed border-ink/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-bold">{SEO_PAGE_LABELS[key]}</span>
              <span className="font-mono text-[11px] text-ink2">{PAGE_PATH[key]}</span>
            </div>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Заголовок вкладки (title)</span>
                <input
                  value={seo.pages[key].title}
                  onChange={(e) => setPage(key, { title: e.target.value })}
                  className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]"
                />
              </label>
              <label className="block">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
                  Описание (meta description) <span className="font-normal normal-case">— обычно 120–160 символов</span>
                </span>
                <textarea
                  value={seo.pages[key].description}
                  onChange={(e) => setPage(key, { description: e.target.value })}
                  rows={2}
                  className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]"
                />
                <span className={`mt-1 block text-right font-mono text-[10.5px] ${seo.pages[key].description.length > 160 ? "text-red" : "text-ink2"}`}>
                  {seo.pages[key].description.length}
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={() => setSeo(DEFAULT_SEO)} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          <Icon name="refresh" size={14} /> К дефолту
        </button>
        <button onClick={save} disabled={saving} className="btn btn-blue px-5 py-2.5 text-[13px]">
          <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
