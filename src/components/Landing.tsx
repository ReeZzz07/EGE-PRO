import { useEffect, useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { DEFAULT_CONTENT, loadLandingContent, type LandingContent } from "../lib/content";
import { getAvailableSubjects, getEssayTaskTotal, getGlobalPointsTotal, getGlobalTaskTotal, getSubjectTotal, useTasksVersion } from "../lib/dbTasks";
import { DEFAULT_SEO, loadSeoSettings } from "../lib/seo";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, Reveal, Stamp } from "./ui";
import BlogSection from "./BlogSection";
import ReviewsSection from "./ReviewsSection";
import landingStatic from "../../docker/api/content/landingStatic.json";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { loadTariffsContent } from "../lib/tariffsContent";
import { plural } from "../lib/utils";
import FaqAccordion from "./FaqAccordion";
import type { View } from "./Header";

/** Разбивает заголовок на части вокруг выделяемой подстроки и оборачивает её в hl-подсветку. */
function HeroTitle({ title, highlight }: { title: string; highlight: string }) {
  const idx = highlight ? title.indexOf(highlight) : -1;
  if (idx === -1) return <>{title}</>;
  return (
    <>
      {title.slice(0, idx)}
      <span className="hl">{highlight}</span>
      {title.slice(idx + highlight.length)}
    </>
  );
}

export default function Landing({
  onStart,
  onLogin,
  scrollTo,
  scrollNonce,
  onNav,
}: {
  onStart: (subject?: Subject) => void;
  onLogin: () => void;
  scrollTo?: string;
  scrollNonce?: number;
  onNav: (v: View) => void;
}) {
  const [content, setContent] = useState<LandingContent>(DEFAULT_CONTENT);
  const [seo, setSeo] = useState(DEFAULT_SEO);

  useEffect(() => {
    let cancelled = false;
    loadLandingContent().then((c) => {
      if (!cancelled) setContent(c);
    });
    loadSeoSettings().then((s) => {
      if (!cancelled) setSeo(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useDocumentHead({ ...seo.pages.home, path: "/", ogImage: seo.ogImage });

  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, scrollNonce]);

  useTasksVersion();
  const availableSubjects = getAvailableSubjects();
  // тарифы и условия оплаты на главной: те же цены, что на /tariffs; роботам эти же данные отдаёт docker/api/botPages.js
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [paymentNote, setPaymentNote] = useState("");
  useEffect(() => {
    loadActiveTariffs().then(setTariffs).catch(() => {});
    loadTariffsContent().then((c) => setPaymentNote(c.paymentNote)).catch(() => {});
  }, []);

  // Иллюстративный образец для лендинга — не тянем из банка (гость видит эту страницу до того,
  // как банк вообще подгрузился), поэтому просто фиксированный пример «как выглядит задание».
  const preview = { ...landingStatic.preview, subject: landingStatic.preview.subject as Subject };

  return (
    <div className="mx-auto max-w-[1600px] px-4">
      {/* ─── Блок 1: первый экран ─── */}
      <div className="mt-6 flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-blue">● новый ученик</span>
        <button onClick={onLogin} className="link-slide text-[13px] font-bold text-ink2 hover:text-ink">
          Уже есть аккаунт? Войти
        </button>
      </div>

      <section className="sheet sheet-holes gridpaper relative mt-4 overflow-hidden sm:mt-6">
        <div className="absolute right-5 top-5 hidden text-ink/70 sm:block" aria-hidden>
          <svg width="110" height="34" viewBox="0 0 110 34">
            {[3, 8, 11, 17, 22, 25, 31, 38, 41, 47, 52, 58, 61, 67, 70, 76, 83, 86, 92, 97, 103].map((x, i) => (
              <rect key={i} x={x} y="0" width={i % 3 === 0 ? 3 : 1.5} height="26" fill="currentColor" />
            ))}
            <text x="0" y="33" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="currentColor">
              БЛАНК · ДИАГНОСТИКА
            </text>
          </svg>
        </div>

        <div className="grid grid-cols-1 gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div className="min-w-0">
            <h1 className="font-display text-[9vw] font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              <HeroTitle title={content.hero.title} highlight={content.hero.highlight} />
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink2">{content.hero.subtitle}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={() => onStart()} className="btn btn-blue px-6 py-3.5 text-sm">
                {landingStatic.heroCtas[0]} <Icon name="arrowR" size={17} />
              </button>
              <button onClick={() => onStart()} className="btn btn-ghost px-6 py-3.5 text-sm">
                {landingStatic.heroCtas[1]}
              </button>
            </div>

            {/* цифры банка заданий — конкретика вместо общих слов */}
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t-2 border-dashed border-ink/20 pt-5">
              {[
                [String(getGlobalTaskTotal()), landingStatic.statLabels[0]],
                [String(availableSubjects.length), landingStatic.statLabels[1]],
                [String(getGlobalPointsTotal()), landingStatic.statLabels[2]],
                [String(getEssayTaskTotal()), landingStatic.statLabels[3]],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="font-display text-2xl font-black leading-none text-ink">{v}</div>
                  <div className="mt-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink2">{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* образец задания — наглядно показываем сам продукт */}
          <div className="card-lift relative mx-auto w-full min-w-0 max-w-md rotate-1 lg:max-w-lg">
            <p className="mb-3 text-center font-mono text-[11.5px] font-bold uppercase tracking-[0.2em] text-ink2">{landingStatic.previewTitle}</p>
            <div className="sheet sheet-margin relative p-7 pl-14 sm:p-8 sm:pl-16">
              <span className="pointer-events-none absolute right-4 top-4 z-10">
                <Stamp text="Верно" tone="green" />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display border-2 border-blue px-2.5 py-1 text-[12.5px] font-black text-blue">{SUBJECTS[preview.subject].name}</span>
                <span className="rounded-sm border border-ink/25 px-2.5 py-1 font-mono text-[12px] text-ink2">№ {preview.fipiId}</span>
              </div>
              <h3 className="font-display mt-4 text-xl font-bold leading-snug">{preview.topic}</h3>
              <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink/85">{preview.statement}</p>
              <div className="mt-5 flex items-center gap-2.5">
                <div className="input-blank flex-1 rounded-sm px-4 py-3 text-center font-mono text-xl font-bold">{preview.answer}</div>
                <span className="btn btn-blue px-4 py-3 text-sm">
                  <Icon name="check" size={18} />
                </span>
              </div>
              <p className="mt-4 font-mono text-[12px] text-ink2">{preview.note} · {preview.points} п.б.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── бегущая строка ─── */}
      {content.ticker.length > 0 && (
        <div className="mt-6 overflow-hidden border-y-2 border-ink bg-ink py-2" aria-hidden>
          <div className="marquee-track gap-10 font-mono text-[13px] font-semibold text-paper/90">
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0 gap-10">
                {content.ticker.map((f, i) => (
                  <span key={i} className="flex items-center gap-10">
                    {f} <span className="text-hl">✦</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Блок 2: быстрый выбор предмета ─── */}
      <section id="subjects" className="mt-14 scroll-mt-20">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 1</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">С какого предмета начнём?</h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-ink2">{landingStatic.subjectsIntro.replace("{n}", String(availableSubjects.length))}</p>
        </Reveal>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {availableSubjects.map((id, i) => {
            const s = SUBJECTS[id];
            return (
            <Reveal key={s.id} delay={i * 60}>
              <button onClick={() => onStart(s.id)} className="sheet card-lift group flex w-full items-center gap-3 p-4 text-left">
                <span className={`font-display flex h-11 w-11 shrink-0 items-center justify-center border-2 border-ink text-[12px] font-black ${s.color}`}>{s.short}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{s.name}</span>
                  <span className="block truncate text-[12px] text-ink2">{s.desc}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink2">{getSubjectTotal(s.id)} заданий</span>
                <Icon name="arrowR" size={16} className="shrink-0 text-ink2 transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </button>
            </Reveal>
            );
          })}
        </div>
      </section>

      {/* ─── Блок 2.5: как проходит подготовка ─── */}
      <section className="mt-16">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">как это устроено</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Четыре шага от диагностики до пробника</h2>
        </Reveal>
        <div className="relative mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="absolute left-0 right-0 top-6 hidden border-t-2 border-dashed border-ink/25 lg:block" aria-hidden />
          {content.process.map((s, i) => (
            <Reveal key={s.n + i} delay={i * 90}>
              <div className="relative">
                <span className="font-display relative z-10 inline-flex h-12 w-12 items-center justify-center border-2 border-ink bg-hl text-sm font-black shadow-[3px_3px_0_0_#15172e]">
                  {s.n}
                </span>
                <h3 className="font-display mt-3 flex items-center gap-2 text-[14.5px] font-bold leading-snug">
                  <Icon name={s.icon} size={16} className="text-blue" /> {s.t}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Блок 3: что умеет платформа ─── */}
      <section id="features" className="mt-16 scroll-mt-20">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">что внутри</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Не решебник, а нормальная подготовка</h2>
        </Reveal>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.capabilities.map((c, i) => (
            <Reveal key={c.t + i} delay={i * 60}>
              <div className="sheet h-full p-5">
                <span className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-hl text-ink">
                  <Icon name={c.icon} size={18} />
                </span>
                <h3 className="font-display mt-3 text-[15px] font-bold leading-snug">{c.t}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Тарифы: те же цены, что на /tariffs; роботам этот блок отдаёт docker/api/botPages.js ─── */}
      {tariffs.length > 0 && (
        <section id="tariffs-home" className="mt-16 scroll-mt-20">
          <Reveal>
            <h2 className="font-display text-2xl font-black sm:text-3xl">{landingStatic.tariffsTitle}</h2>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {tariffs.map((t) => {
                const price = t.salePriceRub ?? t.priceRub;
                return (
                  <div key={t.id} className="sheet p-5">
                    <h3 className="font-display text-[16px] font-black">{t.name}</h3>
                    <p className="font-display mt-1 text-2xl font-black">{price === 0 ? "бесплатно" : `${Math.round(price).toLocaleString("ru-RU")} ₽`}</p>
                    <p className="font-mono text-[11.5px] text-ink2">
                      {price > 0 ? "на 30 дней · " : ""}
                      {t.subjectsCount} {plural(t.subjectsCount, "предмет", "предмета", "предметов")}
                    </p>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">{t.dailyAiLimit != null ? `до ${t.dailyAiLimit} обращений к ИИ-репетитору в день` : "безлимитный ИИ-репетитор"}</p>
                  </div>
                );
              })}
            </div>
            {paymentNote && <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-ink2">{paymentNote}</p>}
            <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ghost mt-4 px-5 py-2.5 text-[13px]">
              Все тарифы и условия оплаты
            </button>
          </Reveal>
        </section>
      )}

      {/* ─── Блок 4: принцип честной помощи ─── */}
      <section id="principle" className="mt-16 scroll-mt-20">
        <Reveal>
          <div className="gridpaper-dark relative overflow-hidden border-2 border-night bg-night px-6 py-9 text-paper sm:px-10">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-hl">{landingStatic.principle.eyebrow}</span>
            <p className="font-display mt-3 max-w-2xl text-xl font-bold leading-snug sm:text-2xl">
              {landingStatic.principle.title}
            </p>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-paper/70">
              {landingStatic.principle.text}
            </p>

            {/* мини-пример диалога — принцип на конкретном примере */}
            <div className="mt-6 max-w-lg space-y-2">
              <div className="ml-auto w-fit max-w-[85%] rounded-md rounded-br-none bg-blue px-3.5 py-2 text-[13px] text-white">{landingStatic.principle.dialog[0]}</div>
              <div className="w-fit max-w-[85%] rounded-md rounded-bl-none border border-white/10 bg-night2 px-3.5 py-2 text-[13px] text-paper/85">
                {landingStatic.principle.dialog[1]}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ─── Блок 5: методическая опора ─── */}
      <section className="mt-10">
        <Reveal>
          <p className="border-l-4 border-blue bg-blue/5 px-4 py-3 text-[13px] leading-relaxed text-ink2">
            <strong className="text-ink">{landingStatic.method.label}</strong> {landingStatic.method.text}
          </p>
        </Reveal>
      </section>

      {/* ─── Блок FAQ ─── */}
      <section className="mt-16">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">частые вопросы</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Коротко о главном</h2>
        </Reveal>
        <Reveal>
          <FaqAccordion items={content.faq} className="mt-6 mx-auto max-w-3xl space-y-3" />
        </Reveal>
      <p className="mt-5 text-[13px] text-ink2">
          Не нашёл ответ?{" "}
          <button onClick={() => onNav({ name: "contacts" })} className="link-slide font-bold text-ink hover:text-blue">
            Напиши нам
          </button>{" "}
          — ответим в течение одного дня.
        </p>
      </section>

      <ReviewsSection />

      <BlogSection onNav={onNav} />

      {/* ─── Блок 6: финальный CTA ─── */}
      <section className="mt-14 pb-16 text-center">
        <Reveal>
          <h2 className="font-display mx-auto max-w-lg text-2xl font-black sm:text-3xl">{landingStatic.ctaFinal.title}</h2>
          <p className="mt-2 text-[13.5px] text-ink2">{landingStatic.ctaFinal.text}</p>
          <button onClick={() => onStart()} className="btn btn-blue mx-auto mt-6 px-7 py-3.5 text-sm">
            {landingStatic.ctaFinal.button} <Icon name="arrowR" size={17} />
          </button>
        </Reveal>
      </section>
    </div>
  );
}
