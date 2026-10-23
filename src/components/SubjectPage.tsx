// Посадочная страница предмета (/ege/<адрес>): что за подготовка, какие разделы и темы в тренажёре, как проходит подготовка, вопросы и ответы.
// Сюда ведёт реклама и поиск по запросам вроде «подготовка к ЕГЭ по биологии». Роботам и нейросетям та же страница отдаётся готовым HTML
// (docker/api/botPages.js, getSubjectPage); тексты общие (docker/api/content/subjects.json).
import { useEffect, useState } from "react";
import type { Subject } from "../data/tasks";
import { DEFAULT_CONTENT, loadLandingContent, type ProcessItem } from "../lib/content";
import { loadSubjectContent, subjectPagePath, SUBJECT_PAGES, type SubjectContent } from "../lib/subjectPage";
import { useDocumentHead } from "../lib/useDocumentHead";
import { plural } from "../lib/utils";
import { Icon } from "./ui";
import FaqAccordion from "./FaqAccordion";
import type { View } from "./Header";

const tasks = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "задание", "задания", "заданий")}`;
const fill = (text: string, dative: string) => text.replace("{dative}", dative);

export default function SubjectPage({ subject, onStart, onNav }: { subject: Subject; onStart: (s: Subject) => void; onNav: (v: View) => void }) {
  const meta = SUBJECT_PAGES.subjects[subject];
  const [content, setContent] = useState<SubjectContent | null>(null);
  const [steps, setSteps] = useState<ProcessItem[]>(DEFAULT_CONTENT.process);

  useEffect(() => {
    let alive = true;
    setContent(null);
    loadSubjectContent(subject).then((c) => alive && setContent(c));
    loadLandingContent().then((c) => alive && setSteps(c.process)).catch(() => {}); // шаги по умолчанию остаются
    return () => {
      alive = false;
    };
  }, [subject]);

  const lead = `${content ? `${tasks(content.total)} из открытого банка ФИПИ по предмету` : "Задания из открытого банка ФИПИ по предмету"} «${meta.name}»: ${meta.desc.replace(/\.$/, "")}.`;
  useDocumentHead({
    title: `Подготовка к ЕГЭ по ${meta.dative} — ЕГЭ·ПРО`,
    description: `${lead} Диагностика, личный план и ИИ-репетитор, который объясняет, а не решает за тебя.`,
    path: subjectPagePath(subject),
  });

  const others = SUBJECT_PAGES.landingSubjects.filter((s) => s !== subject);
  const list = (items: { name: string; n: number }[]) => (
    <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-2">
      {items.map((x) => (
        <li key={x.name} className="flex items-baseline justify-between gap-3 border-b border-ink/10 pb-1">
          <span>{x.name}</span>
          <span className="shrink-0 font-mono text-[11.5px] text-ink2">{tasks(x.n)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="mt-8 sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">подготовка к егэ</p>
        <h1 className="font-display mt-2 text-2xl font-black leading-tight sm:text-4xl">Подготовка к ЕГЭ по {meta.dative}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">{lead}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => onStart(subject)} className="btn btn-blue px-5 py-2.5 text-[13.5px]">
            Пройти бесплатную диагностику <Icon name="arrowR" size={15} />
          </button>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink px-5 py-2.5 text-[13.5px]">Тарифы</button>
          <button onClick={() => onNav({ name: "parents" })} className="btn btn-ghost px-5 py-2.5 text-[13.5px]">Родителям</button>
        </div>
      </div>

      {content && (content.sections.length > 0 || content.topics.length > 0) && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-black">{SUBJECT_PAGES.sectionsTitle}</h2>
          {content.sections.length > 0 && (
            <>
              <h3 className="font-display mt-4 text-[15px] font-bold">Разделы</h3>
              {list(content.sections)}
            </>
          )}
          {content.topics.length > 0 && (
            <>
              <h3 className="font-display mt-5 text-[15px] font-bold">{content.sections.length > 0 ? "Самые большие темы" : "Темы"}</h3>
              {list(content.topics)}
            </>
          )}
        </section>
      )}

      {steps.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-black">Как проходит подготовка</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.t} className="sheet p-5">
                <p className="font-display text-2xl font-black text-blue">{i + 1}</p>
                <h3 className="font-display mt-1 text-[16px] font-black">{s.t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-display text-xl font-black">{SUBJECT_PAGES.faqTitle}</h2>
        <FaqAccordion items={SUBJECT_PAGES.faq.map((f) => ({ q: fill(f.q, meta.dative), a: fill(f.a, meta.dative) }))} />
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl font-black">Другие предметы</h2>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">
          {others.map((s) => (
            <li key={s}>
              <button onClick={() => onNav({ name: "subject-page", subject: s })} className="link-slide font-bold hover:text-ink">
                {SUBJECT_PAGES.subjects[s].name}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" data-testid="subject-usp">
        <h2 className="font-display text-xl font-black">{SUBJECT_PAGES.uspTitle}</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {SUBJECT_PAGES.usp.map((u) => (
            <li key={u.t} className="sheet flex items-start gap-3 p-4">
              <Icon name="check" size={18} className="mt-0.5 shrink-0 text-blue" />
              <div>
                <p className="font-display text-[14px] font-bold">{u.t}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{u.d}</p>
              </div>
            </li>
          ))}
        </ul>
        <button onClick={() => onStart(subject)} className="btn btn-blue mt-6 px-5 py-2.5 text-[13.5px]">
          Пройти бесплатную диагностику <Icon name="arrowR" size={15} />
        </button>
      </section>
    </div>
  );
}
