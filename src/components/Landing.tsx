import { useEffect, useState } from "react";
import { SUBJECTS, type Subject } from "../data/tasks";
import { DEFAULT_CONTENT, loadLandingContent, type LandingContent } from "../lib/content";
import { getAvailableSubjects, getEssayTaskTotal, getGlobalPointsTotal, getGlobalTaskTotal, getSubjectTotal, useTasksVersion } from "../lib/dbTasks";
import { DEFAULT_SEO, loadSeoSettings } from "../lib/seo";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, Reveal, Stamp } from "./ui";
import BlogSection from "./BlogSection";
import ReviewsSection from "./ReviewsSection";
import PrincipleChat from "./PrincipleChat";
import landingStatic from "../../docker/api/content/landingStatic.json";
import landingMore from "../../docker/api/content/landingMore.json";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { loadTariffsContent } from "../lib/tariffsContent";
import { plural } from "../lib/utils";
import FaqAccordion from "./FaqAccordion";
import type { View } from "./Header";

/** Подставляет в текст из landingMore.json живые цифры банка: «{tasks}» → «51 391 задание», «{subjects}» → «11 предметам», «{essay}» → «7 232 задания».
 *  Та же подстановка на сервере — fillBankText в docker/api/botPages.js. */
function fillBank(text: string, tasks: number, subjects: number, essay: number): string {
  const n = (v: number) => v.toLocaleString("ru-RU");
  return text
    .replace("{tasks}", `${n(tasks)} ${plural(tasks, "задание", "задания", "заданий")}`)
    .replace("{subjects}", `${subjects} ${plural(subjects, "предмету", "предметам", "предметам")}`)
    .replace("{essay}", `${n(essay)} ${plural(essay, "задание", "задания", "заданий")}`);
}

/** Внутренняя ссылка из landingMore.json: настоящий href, но обычный клик не перезагружает страницу. */
function toView(href: string): View | null {
  if (href === "/parents") return { name: "parents" } as View;
  const m = href.match(/^\/blog\/([a-z0-9-]+)$/);
  return m ? { name: "blog-article", slug: m[1] } : null;
}

function CtaButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className="btn btn-blue cta-nudge cta-shine shrink-0 whitespace-nowrap px-6 py-3.5 text-sm">
      {children} <Icon name="arrowR" size={17} />
    </button>
  );
}

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
  const [perSubjectNote, setPerSubjectNote] = useState("");
  useEffect(() => {
    loadActiveTariffs().then(setTariffs).catch(() => {});
    loadTariffsContent().then((c) => setPerSubjectNote(c.perSubjectNote ?? "")).catch(() => {});
  }, []);

  const go = (e: React.MouseEvent, href: string) => {
    const v = toView(href);
    if (!v || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNav(v);
  };

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

      {/* ─── Короткий самостоятельный ответ «что это» ─── */}
      <section id="about" className="mt-14 scroll-mt-20">
        <Reveal className="pop">
          <div className="relative overflow-hidden border-2 border-ink bg-blue px-6 py-9 text-white shadow-[6px_6px_0_0_#15172e] sm:px-10 sm:py-11">
            <div className="gridpaper-dark pointer-events-none absolute inset-0 opacity-30" aria-hidden />
            <div className="relative grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.6fr] lg:gap-14">
              <div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-hl">коротко</span>
                <h2 className="font-display mt-2 text-3xl font-black leading-tight sm:text-4xl">
                  Что такое <span className="text-hl">ЕГЭ·ПРО</span>
                </h2>
              </div>
              <p className="text-[16px] leading-[1.75] text-white/95">{fillBank(landingMore.shortAnswer.text, getGlobalTaskTotal(), availableSubjects.length, getEssayTaskTotal())}</p>
            </div>
          </div>
        </Reveal>
      </section>

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
        <p className="mt-6 text-[13px] text-ink2">
          {landingMore.processNote.before}{" "}
          <a href={landingMore.processNote.href} onClick={(e) => go(e, landingMore.processNote.href)} className="link-slide font-bold text-ink hover:text-blue">
            {landingMore.processNote.linkText}
          </a>
          .
        </p>
        {/* вторая кнопка запуска диагностики: сразу после «Как это устроено» */}
        <Reveal className="from-left mt-10">
          <div className="flex flex-col items-start gap-5 border-2 border-ink bg-hl px-6 py-6 shadow-[5px_5px_0_0_#15172e] sm:flex-row sm:items-center sm:justify-between sm:px-9">
            <p className="font-display max-w-2xl text-[17px] font-bold leading-snug text-ink sm:text-xl">{landingMore.ctaMid.text}</p>
            <CtaButton onClick={() => onStart()}>{landingMore.ctaMid.button}</CtaButton>
          </div>
        </Reveal>
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

      {/* ─── Блок 4: принцип честной помощи ─── */}
      <section id="principle" className="mt-16 scroll-mt-20">
        <Reveal>
          <div className="gridpaper-dark relative overflow-hidden border-2 border-night bg-night px-6 py-10 text-paper sm:px-10 sm:py-12">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
              <div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-hl">{landingStatic.principle.eyebrow}</span>
                <p className="font-display mt-3 text-2xl font-bold leading-snug sm:text-[2rem] sm:leading-tight">{landingStatic.principle.title}</p>
                <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-paper/75">{landingStatic.principle.text}</p>

                {/* три уровня подсказок: от намёка до почти полного разбора */}
                <h3 className="font-display mt-8 text-xl font-bold">{landingMore.hints.title}</h3>
                <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-paper/70">{landingMore.hints.intro}</p>
                <ol className="mt-5 max-w-xl space-y-3">
                  {landingMore.hints.items.map((h, i) => (
                    <li key={h.t} className="hover-rise relative border border-white/15 bg-night2 p-4 pt-5">
                      <span className="grow-bar absolute -top-px left-0 h-1 bg-hl" style={{ width: `${(i + 1) * 33.3}%`, transitionDelay: `${450 + i * 200}ms` }} aria-hidden />
                      <h4 className="font-display text-[15px] font-bold text-hl">{h.t}</h4>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-paper/80">{h.d}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* интерактивное демо: подсказки и свободный ввод; ответы заранее написаны */}
              <Reveal className="from-right">
                <div className="float-soft">
                  <PrincipleChat onStart={() => onStart()} />
                </div>
              </Reveal>
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

      {/* Общий ритм новых блоков: слева заголовок, справа содержание; на телефоне всё в одну колонку. */}

      {/* ─── Чем отличается от обычной нейросети ─── */}
      <section id="difference" className="mt-20 scroll-mt-20">
        <Reveal>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-12">
            <h2 className="font-display text-2xl font-black leading-tight sm:text-3xl">{landingMore.diff.title}</h2>
            <p className="text-[14.5px] leading-relaxed text-ink2">{landingMore.diff.intro}</p>
          </div>
        </Reveal>
        {/* 5 карточек: три в первом ряду и две широких во втором — без «осиротевших» ячеек */}
        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-6">
          {landingMore.diff.items.map((d, i) => (
            <li key={d.t} className={`list-none ${i < 3 ? "md:col-span-2" : "md:col-span-3"}`}>
              <Reveal delay={i * 60} className="h-full">
                <div className="sheet hover-rise h-full p-6">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-blue">{i + 1} / {landingMore.diff.items.length}</span>
                  <h3 className="font-display mt-2 text-[16px] font-bold leading-snug">{d.t}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">{d.d}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Проверка сочинения и развёрнутых ответов ─── */}
      <section id="essay-check" className="mt-20 scroll-mt-20">
        <Reveal className="from-left">
          <div className="grid grid-cols-1 gap-4 border-l-4 border-blue bg-blue/5 px-6 py-8 sm:px-10 lg:grid-cols-[1fr_1.6fr] lg:gap-12">
            <h2 className="font-display text-2xl font-black leading-tight sm:text-3xl">{landingMore.essay.title}</h2>
            <p className="text-[15px] leading-relaxed text-ink/85">{fillBank(landingMore.essay.text, getGlobalTaskTotal(), availableSubjects.length, getEssayTaskTotal())}</p>
          </div>
        </Reveal>
      </section>

      {/* ─── Тарифы и оплата: HTML-таблица, те же цены, что на /tariffs; роботам блок отдаёт docker/api/botPages.js ─── */}
      {tariffs.length > 0 && (
        <section id="tariffs-home" className="mt-20 scroll-mt-20">
          <Reveal>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">цены</p>
            <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">{landingMore.tariffs.title}</h2>
            <div className="mt-6 overflow-x-auto border-2 border-ink bg-paper shadow-[6px_6px_0_0_#15172e]">
              <table className="stagger-rows w-full min-w-[36rem] border-collapse text-left text-[14px]">
                <thead>
                  <tr className="bg-blue font-mono text-[11.5px] uppercase tracking-[0.14em] text-white">
                    {landingMore.tariffs.head.map((h) => (
                      <th key={h} scope="col" className="px-3 py-4 font-bold sm:px-6">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((t, ti) => {
                    const price = t.salePriceRub ?? t.priceRub;
                    const onSale = t.salePriceRub != null && t.salePriceRub < t.priceRub;
                    return (
                      <tr key={t.id} style={{ ["--i" as string]: ti }} className="border-b-2 border-ink/10 transition-colors last:border-0 hover:bg-blue/5">
                        <th scope="row" className="px-3 py-5 sm:px-6">
                          <span className="font-display text-[16px] font-black">{t.name}</span>
                        </th>
                        <td className="whitespace-nowrap px-3 py-5 sm:px-6">
                          {price === 0 ? (
                            <span className="pop-in font-display inline-block border-2 border-ink bg-hl px-2.5 py-0.5 text-[15px] font-black">0 ₽</span>
                          ) : (
                            <>
                              <span className="pop-in font-display text-[19px] font-black text-blue">{Math.round(price).toLocaleString("ru-RU")} ₽</span>
                              <span className="text-[13px] text-ink2"> за 30 дней</span>
                              {onSale && <span className="ml-2 text-[13px] text-ink2 line-through">{Math.round(t.priceRub).toLocaleString("ru-RU")} ₽</span>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-5 sm:px-6">
                          <span className="inline-block rounded-sm bg-blue/10 px-2.5 py-1 text-[13px] font-bold text-blue">{t.subjectsCount} на выбор</span>
                        </td>
                        <td className="px-3 py-5 sm:px-6">
                          {t.dailyAiLimit != null ? (
                            <span className="text-ink2">до {t.dailyAiLimit} обращений в день</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-bold text-ink">
                              <Icon name="check" size={16} className="text-blue" />без лимита
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="hover-rise border-l-4 border-blue bg-blue/5 px-5 py-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-blue">что входит</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink/85">
                  {landingMore.tariffs.allPlans}
                  {perSubjectNote && tariffs.some((t) => t.priceRub > 0) ? ` ${perSubjectNote.charAt(0).toUpperCase()}${perSubjectNote.slice(1)}.` : ""}
                </p>
              </div>
              <div className="hover-rise border-l-4 border-hl bg-hl/20 px-5 py-4">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink">как оплатить</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink/85">{landingMore.tariffs.payment}</p>
              </div>
            </div>
            <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue cta-nudge mt-6 px-6 py-3 text-sm">
              {landingMore.tariffs.link} <Icon name="arrowR" size={17} />
            </button>
          </Reveal>
        </section>
      )}

      {/* ─── Ограничения — честно ─── */}
      <section id="limits" className="mt-20 scroll-mt-20">
        <Reveal>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <h2 className="font-display text-2xl font-black leading-tight sm:text-3xl">{landingMore.limits.title}</h2>
            <p className="text-[13.5px] leading-relaxed text-ink2">
              {landingMore.limits.article.before}{" "}
              <a href={landingMore.limits.article.href} onClick={(e) => go(e, landingMore.limits.article.href)} className="link-slide font-bold text-ink hover:text-blue">
                {landingMore.limits.article.linkText}
              </a>
              .
            </p>
          </div>
        </Reveal>
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {landingMore.limits.items.map((l, i) => (
            <li key={l.t} className="list-none">
              <Reveal delay={i * 60} className="h-full">
                <div className="sheet hover-rise h-full p-5">
                  <span className="font-display flex h-9 w-9 items-center justify-center border-2 border-ink bg-hl text-[15px] font-black" aria-hidden>
                    !
                  </span>
                  <h3 className="font-display mt-3.5 text-[15.5px] font-bold leading-snug">{l.t}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">{l.d}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Для родителей ─── */}
      <section id="for-parents" className="mt-20 scroll-mt-20">
        <Reveal className="pop">
          <div className="sheet grid grid-cols-1 items-center gap-6 px-6 py-8 sm:px-10 lg:grid-cols-[1fr_1.6fr_auto] lg:gap-10">
            <h2 className="font-display text-2xl font-black leading-tight sm:text-3xl">{landingMore.parents.title}</h2>
            <p className="text-[14.5px] leading-relaxed text-ink/85">{landingMore.parents.text}</p>
            <a href={landingMore.parents.href} onClick={(e) => go(e, landingMore.parents.href)} className="btn btn-ghost justify-self-start whitespace-nowrap px-5 py-2.5 text-[13px] lg:justify-self-end">
              {landingMore.parents.linkText}
            </a>
          </div>
        </Reveal>
      </section>

      {/* ─── Блок FAQ ─── */}
      <section className="mt-16">
        <Reveal>
          <div className="text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">{landingMore.headings.faqEyebrow}</p>
            <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">{landingMore.headings.faq}</h2>
          </div>
        </Reveal>
        <Reveal>
          <FaqAccordion items={content.faq} className="mt-6 mx-auto max-w-3xl space-y-3" />
        </Reveal>
        {/* «не нашёл ответ» — отдельная заметная плашка по центру, под шириной списка вопросов */}
        <Reveal>
          <div className="sheet mx-auto mt-8 flex max-w-3xl flex-col items-center gap-4 px-6 py-7 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-display text-lg font-black">Не нашёл ответ?</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">Напиши нам — ответим в течение одного дня.</p>
            </div>
            <button onClick={() => onNav({ name: "contacts" })} className="btn btn-blue shrink-0 px-6 py-3 text-sm">
              Напиши нам <Icon name="arrowR" size={17} />
            </button>
          </div>
        </Reveal>
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
