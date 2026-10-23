// Страница для родителей (/parents): что за сервис, чем он отличается от занятий с репетитором, как
// занимается ребёнок и как оплатить за него. Публичная, есть в
// sitemap.xml и в главном меню; сюда можно вести рекламу на родителей (ВК, поиск вроде «подготовка к ЕГЭ
// онлайн для ребёнка»). Тон сравнения мягкий: тренажёр не выдаётся за замену живому человеку.
import { useEffect, useState } from "react";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { DEFAULT_SEO, loadSeoSettings } from "../lib/seo";
import { useDocumentHead } from "../lib/useDocumentHead";
import { plural } from "../lib/utils";
import { Icon } from "./ui";
import FaqAccordion from "./FaqAccordion";
import parentsContent from "../../docker/api/content/parents.json";

/** Источник текста — docker/api/content/parents.json: тот же файл читает сервер, когда отдаёт страницу ботам (docker/api/botPages.js). */
const P = parentsContent;

/** Строка таблицы «Репетитор и ЕГЭ·ПРО»: токен {price} — «От X за 30 дней, » (если тарифы загрузились) или «Фиксированная цена за 30 дней, ». */
const usText = (us: string, minPrice: string) => us.replace("{price}", minPrice ? P.priceFrom.replace("{p}", minPrice) : P.priceFlat);

const rubles = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
import type { View } from "./Header";




export default function ParentsView({ onNav }: { onNav: (v: View) => void }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [seo, setSeo] = useState(DEFAULT_SEO);

  useEffect(() => {
    loadActiveTariffs().then(setTariffs);
    loadSeoSettings().then(setSeo);
  }, []);

  useDocumentHead({
    title: P.seo.title,
    description: P.seo.description,
    path: "/parents",
    ogImage: seo.ogImage,
  });

  const paid = tariffs.filter((t) => t.priceRub > 0);
  const minPrice = paid.length ? rubles(Math.min(...paid.map((t) => t.salePriceRub ?? t.priceRub))) : "";

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="mt-8 sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">{P.eyebrow}</p>
        <h1 className="font-display mt-2 text-2xl font-black leading-tight sm:text-4xl">{P.h1}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">
          {P.intro}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-blue px-5 py-2.5 text-[13.5px]">Начать бесплатно</button>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink px-5 py-2.5 text-[13.5px]">Посмотреть тарифы</button>
        </div>
      </div>

            <h2 className="font-display mt-12 text-xl font-black">{P.vsTitle}</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink2">{P.vsIntro}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-2 border-ink text-left text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="w-[18%] bg-ink px-3 py-2.5 font-bold" />
              <th scope="col" className="w-[36%] bg-ink px-3 py-2.5 font-bold text-paper/80">{P.vsHeaders[1]}</th>
              <th scope="col" className="w-[46%] bg-blue px-3 py-2.5 font-bold text-white">{P.vsHeaders[2]}</th>
            </tr>
          </thead>
          <tbody>
            {P.vs.map((v, idx) => (
              <tr key={v.row} className={idx % 2 ? "bg-ink/[0.04]" : "bg-sheet"}>
                <th scope="row" className="px-3 py-3 align-top font-bold">{v.row}</th>
                <td className="px-3 py-3 align-top leading-relaxed text-ink2">{v.tutor}</td>
                <td className="bg-blue/[0.07] px-3 py-3 align-top font-medium leading-relaxed text-ink">
                  <span className="flex items-start gap-2">
                    <Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />
                    <span>{usText(v.us, minPrice)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display mt-12 text-xl font-black">{P.stepsTitle}</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2">
        {P.steps.map((s, i) => (
          <li key={s.t} className="sheet p-5">
            <p className="font-display text-2xl font-black text-blue">{i + 1}</p>
            <h3 className="font-display mt-1 text-[16px] font-black">{s.t}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{s.d}</p>
          </li>
        ))}
      </ol>

      {paid.length > 0 && (
        <>
          <h2 className="font-display mt-12 text-xl font-black">{P.tariffsTitle}</h2>
          <p className="mt-1 text-[13.5px] text-ink2">{P.tariffsIntro}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {paid.map((t) => (
              <div key={t.id} className="sheet p-5">
                <h3 className="font-display text-[16px] font-black">{t.name}</h3>
                <p className="font-display mt-1 text-2xl font-black">{rubles(t.salePriceRub ?? t.priceRub)}</p>
                <p className="font-mono text-[11.5px] text-ink2">на 30 дней · {t.subjectsCount} {plural(t.subjectsCount, "предмет", "предмета", "предметов")}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-ink2">{P.tariffsNote}</p>
        </>
      )}

      <h2 className="font-display mt-12 text-xl font-black">{P.payTitle}</h2>
      <ol className="mt-4 space-y-3 text-[14px] leading-relaxed text-ink2">
        {P.pay.map((t, i) => (
          <li key={t} className="flex gap-3"><span className="font-display font-black text-blue">{i + 1}</span>{t}</li>
        ))}
      </ol>
      <div className="mt-5">
        <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-ink px-5 py-2.5 text-[13px]">Зарегистрировать ученика</button>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {P.trust.map((x) => (
          <div key={x.t} className="sheet flex items-start gap-3 p-4">
            <Icon name="check" size={18} className="mt-0.5 shrink-0 text-blue" />
            <div>
              <p className="font-display text-[14px] font-bold">{x.t}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{x.d}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-display mt-12 text-xl font-black">{P.faqTitle}</h2>
      <FaqAccordion items={P.faq} />

      <p className="mt-10 text-[13px] text-ink2">
        Остались вопросы?{" "}
        <button onClick={() => onNav({ name: "contacts" })} className="link-slide font-bold hover:text-ink">Напишите нам</button>, ответим в течение одного дня. Подробнее:{" "}
        <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold hover:text-ink">публичная оферта</button>,{" "}
        <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold hover:text-ink">политика конфиденциальности</button>.
      </p>
    </div>
  );
}
