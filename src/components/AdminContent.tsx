import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { DEFAULT_CONTENT, ICON_OPTIONS, loadLandingContent, saveLandingBlock, type CapabilityItem, type FaqItem, type HeroContent, type ProcessItem } from "../lib/content";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";
import AdminTaskReview from "./AdminTaskReview";
import AdminAiSettings from "./AdminAiSettings";
import AdminTaskImport from "./AdminTaskImport";
import AdminTariffs from "./AdminTariffs";
import AdminLegalDocs from "./AdminLegalDocs";
import AdminSeoSettings from "./AdminSeoSettings";
import AdminScoreScales from "./AdminScoreScales";

function Field({ label, value, onChange, area }: { label: string; value: string; onChange: (v: string) => void; area?: boolean }) {
  return (
    <label className="block">
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">{label}</span>
      {area ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13.5px]" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]" />
      )}
    </label>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Иконка</span>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-ink bg-hl">
          <Icon name={value} size={16} />
        </span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="input-blank flex-1 rounded-sm px-3 py-2 text-[13px]">
          {ICON_OPTIONS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

function SectionShell({ title, hint, onSave, onReset, children }: { title: string; hint: string; onSave: () => void; onReset: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <p className="mt-1 text-[12.5px] text-ink2">{hint}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onReset} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
            <Icon name="refresh" size={14} /> К дефолту
          </button>
          <button onClick={onSave} className="btn btn-blue px-4 py-2 text-[12.5px]">
            <Icon name="check" size={14} /> Сохранить
          </button>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

export default function AdminContent({ onNav }: { onNav: (v: View) => void }) {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"content" | "tasks" | "import" | "ai" | "tariffs" | "scales" | "legal" | "seo">("content");

  const [hero, setHero] = useState<HeroContent>(DEFAULT_CONTENT.hero);
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>(DEFAULT_CONTENT.capabilities);
  const [process, setProcess] = useState<ProcessItem[]>(DEFAULT_CONTENT.process);
  const [faq, setFaq] = useState<FaqItem[]>(DEFAULT_CONTENT.faq);
  const [ticker, setTicker] = useState<string[]>(DEFAULT_CONTENT.ticker);

  useEffect(() => {
    loadLandingContent().then((c) => {
      setHero(c.hero);
      setCapabilities(c.capabilities);
      setProcess(c.process);
      setFaq(c.faq);
      setTicker(c.ticker);
      setLoading(false);
    });
  }, []);

  const save = async (key: "hero" | "capabilities" | "process" | "faq" | "ticker", data: unknown) => {
    if (!profile) return;
    const res = await saveLandingBlock(key, data, profile.id);
    if (res.error) push(res.error, "err");
    else push("Сохранено — открой лендинг, чтобы увидеть изменения", "ok");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-16 text-center">
        <p className="font-mono text-[13px] font-bold uppercase tracking-widest text-ink2">Загрузка контента…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">админка</p>
          <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Контент лендинга</h1>
        </div>
        <button onClick={() => onNav({ name: "landing" })} className="btn btn-ghost px-4 py-2.5 text-[13px]">
          <Icon name="eye" size={15} /> Открыть лендинг
        </button>
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Supabase не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр форм. См. SETUP.md.
        </p>
      )}

      <div className="mt-6 flex gap-2 border-b-2 border-ink/15 pb-px">
        <button
          onClick={() => setTab("content")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "content" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Контент лендинга
        </button>
        <button
          onClick={() => setTab("tasks")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "tasks" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Задания на проверке
        </button>
        <button
          onClick={() => setTab("import")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "import" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Импорт
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "ai" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          ИИ-репетитор
        </button>
        <button
          onClick={() => setTab("tariffs")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "tariffs" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Тарифы
        </button>
        <button
          onClick={() => setTab("scales")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "scales" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Шкала баллов
        </button>
        <button
          onClick={() => setTab("legal")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "legal" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          Документы
        </button>
        <button
          onClick={() => setTab("seo")}
          className={`px-4 py-2.5 text-[13px] font-bold transition ${tab === "seo" ? "border-b-2 border-blue text-blue" : "text-ink2 hover:text-ink"}`}
        >
          SEO
        </button>
      </div>

      {tab === "tasks" && (
        <div className="mt-6">
          <AdminTaskReview />
        </div>
      )}

      {tab === "import" && (
        <div className="mt-6">
          <AdminTaskImport />
        </div>
      )}

      {tab === "ai" && (
        <div className="mt-6">
          <AdminAiSettings />
        </div>
      )}

      {tab === "tariffs" && (
        <div className="mt-6">
          <AdminTariffs />
        </div>
      )}

      {tab === "scales" && (
        <div className="mt-6">
          <AdminScoreScales />
        </div>
      )}

      {tab === "legal" && (
        <div className="mt-6">
          <AdminLegalDocs />
        </div>
      )}

      {tab === "seo" && (
        <div className="mt-6">
          <AdminSeoSettings />
        </div>
      )}

      {/* ── hero ── */}
      {tab === "content" && (
      <>
      <div className="mt-6">
        <SectionShell
          title="Первый экран"
          hint="Заголовок, подсветка ключевой фразы и подзаголовок."
          onSave={() => save("hero", hero)}
          onReset={() => setHero(DEFAULT_CONTENT.hero)}
        >
          <Field label="Заголовок" value={hero.title} onChange={(v) => setHero({ ...hero, title: v })} area />
          <Field label="Что подсветить жёлтым (должно встречаться в заголовке)" value={hero.highlight} onChange={(v) => setHero({ ...hero, highlight: v })} />
          <Field label="Подзаголовок" value={hero.subtitle} onChange={(v) => setHero({ ...hero, subtitle: v })} area />
        </SectionShell>
      </div>

      {/* ── capabilities ── */}
      <div className="mt-6">
        <SectionShell
          title="Что внутри (карточки возможностей)"
          hint="Список карточек в разделе «Не решебник, а нормальная подготовка»."
          onSave={() => save("capabilities", capabilities)}
          onReset={() => setCapabilities(DEFAULT_CONTENT.capabilities)}
        >
          {capabilities.map((c, i) => (
            <div key={i} className="border-2 border-dashed border-ink/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-ink2">#{i + 1}</span>
                <button onClick={() => setCapabilities(capabilities.filter((_, j) => j !== i))} className="btn btn-ghost px-2.5 py-1.5 text-[11px]">
                  <Icon name="trash" size={13} /> Удалить
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-[auto_1fr]">
                <IconPicker value={c.icon} onChange={(v) => setCapabilities(capabilities.map((x, j) => (j === i ? { ...x, icon: v } : x)))} />
                <Field label="Заголовок" value={c.t} onChange={(v) => setCapabilities(capabilities.map((x, j) => (j === i ? { ...x, t: v } : x)))} />
              </div>
              <div className="mt-3">
                <Field label="Описание" value={c.d} onChange={(v) => setCapabilities(capabilities.map((x, j) => (j === i ? { ...x, d: v } : x)))} area />
              </div>
            </div>
          ))}
          <button
            onClick={() => setCapabilities([...capabilities, { icon: "star", t: "Новая возможность", d: "Описание" }])}
            className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]"
          >
            + Добавить карточку
          </button>
        </SectionShell>
      </div>

      {/* ── process ── */}
      <div className="mt-6">
        <SectionShell
          title="Как это устроено (шаги)"
          hint="Пронумерованные шаги подготовки — номер проставляется автоматически по порядку."
          onSave={() => save("process", process.map((p, i) => ({ ...p, n: String(i + 1).padStart(2, "0") })))}
          onReset={() => setProcess(DEFAULT_CONTENT.process)}
        >
          {process.map((p, i) => (
            <div key={i} className="border-2 border-dashed border-ink/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-ink2">шаг {String(i + 1).padStart(2, "0")}</span>
                <button onClick={() => setProcess(process.filter((_, j) => j !== i))} className="btn btn-ghost px-2.5 py-1.5 text-[11px]">
                  <Icon name="trash" size={13} /> Удалить
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-[auto_1fr]">
                <IconPicker value={p.icon} onChange={(v) => setProcess(process.map((x, j) => (j === i ? { ...x, icon: v } : x)))} />
                <Field label="Заголовок" value={p.t} onChange={(v) => setProcess(process.map((x, j) => (j === i ? { ...x, t: v } : x)))} />
              </div>
              <div className="mt-3">
                <Field label="Описание" value={p.d} onChange={(v) => setProcess(process.map((x, j) => (j === i ? { ...x, d: v } : x)))} area />
              </div>
            </div>
          ))}
          <button
            onClick={() => setProcess([...process, { n: String(process.length + 1).padStart(2, "0"), icon: "star", t: "Новый шаг", d: "Описание" }])}
            className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]"
          >
            + Добавить шаг
          </button>
        </SectionShell>
      </div>

      {/* ── faq ── */}
      <div className="mt-6">
        <SectionShell title="Частые вопросы" hint="Список вопрос-ответ в блоке FAQ." onSave={() => save("faq", faq)} onReset={() => setFaq(DEFAULT_CONTENT.faq)}>
          {faq.map((f, i) => (
            <div key={i} className="border-2 border-dashed border-ink/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-bold text-ink2">#{i + 1}</span>
                <button onClick={() => setFaq(faq.filter((_, j) => j !== i))} className="btn btn-ghost px-2.5 py-1.5 text-[11px]">
                  <Icon name="trash" size={13} /> Удалить
                </button>
              </div>
              <div className="mt-2 space-y-3">
                <Field label="Вопрос" value={f.q} onChange={(v) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: v } : x)))} />
                <Field label="Ответ" value={f.a} onChange={(v) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: v } : x)))} area />
              </div>
            </div>
          ))}
          <button onClick={() => setFaq([...faq, { q: "Новый вопрос", a: "Ответ" }])} className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]">
            + Добавить вопрос
          </button>
        </SectionShell>
      </div>

      {/* ── ticker ── */}
      <div className="mt-6">
        <SectionShell
          title="Бегущая строка"
          hint="Фразы и формулы в полосе под первым экраном лендинга — каждая строка отдельным пунктом."
          onSave={() => save("ticker", ticker)}
          onReset={() => setTicker(DEFAULT_CONTENT.ticker)}
        >
          {ticker.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 font-mono text-[11px] font-bold text-ink2">#{i + 1}</span>
              <input
                value={t}
                onChange={(e) => setTicker(ticker.map((x, j) => (j === i ? e.target.value : x)))}
                className="input-blank flex-1 rounded-sm px-3 py-2 font-mono text-[13px]"
              />
              <button onClick={() => setTicker(ticker.filter((_, j) => j !== i))} className="btn btn-ghost px-2.5 py-2 text-[11px]">
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setTicker([...ticker, "Новая строка"])} className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]">
            + Добавить строку
          </button>
        </SectionShell>
      </div>
      </>
      )}
    </div>
  );
}
