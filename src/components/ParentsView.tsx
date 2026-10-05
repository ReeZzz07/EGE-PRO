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

const rubles = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
import type { View } from "./Header";

const STEPS = [
  { t: "Диагностика", d: "Ребёнок решает 8–12 заданий за 7–10 минут и видит свой уровень, сильные и слабые темы и примерный балл." },
  { t: "Личный план", d: "По итогам диагностики сервис подсказывает, что повторить сегодня и сколько заниматься на неделе." },
  { t: "Задания и подсказки", d: "Задания из открытого банка ФИПИ, ответ проверяется сразу. Если не получается, есть три уровня подсказок и разбор по шагам." },
  { t: "ИИ-репетитор", d: "Объясняет тему и подсказывает ход решения, но готовый ответ сразу не выдаёт. Ребёнок не списывает, а разбирается." },
];

const VS: { row: string; tutor: string; us: (minPrice: string) => string }[] = [
  { row: "Стоимость", tutor: "Обычно 1 800–2 500 ₽ за одно занятие, а занятий в месяц обычно 4–8", us: (p) => `${p ? `От ${p} за 30 дней, ` : "Фиксированная цена за 30 дней, "}занимайтесь сколько нужно: количество занятий не ограничено` },
  { row: "Когда заниматься", tutor: "В часы, о которых договорились; переносы и пропуски съедают оплаченное время", us: () => "Круглосуточно, с телефона или компьютера, в любой удобный момент, без переносов и отмен" },
  { row: "Объём практики", tutor: "Несколько заданий на занятии и домашнее задание", us: () => "Более 50 тысяч заданий из открытого банка ФИПИ, ответ проверяется мгновенно, ошибки собираются в тетрадь и возвращаются по графику" },
  { row: "Объяснение", tutor: "Во время занятия; если вопрос возник вечером, ждать до следующего", us: () => "ИИ-репетитор объясняет по шагам в любой момент, есть три уровня подсказок: ребёнок не списывает, а разбирается" },
  { row: "Личный план", tutor: "Зависит от опыта и времени репетитора на подготовку", us: () => "Диагностика за 7–10 минут и персональный план: что повторить сегодня и сколько заниматься на неделе" },
  { row: "Подготовка к экзамену", tutor: "Пробные варианты по договорённости", us: () => "Пробники в режиме «как на экзамене» со временем и шкалой баллов, статистика и серия занятий подряд" },
  { row: "Кому подойдёт", tutor: "Когда важен личный контакт с учителем", us: () => "Когда нужна регулярная практика каждый день, понятный план и разумная цена; можно и в дополнение к занятиям с репетитором" },
];

const FAQ = [
  { q: "Это замена репетитору?", a: "Для многих семей ЕГЭ·ПРО становится основным способом подготовки: диагностика, план, тысячи заданий и объяснения доступны каждый день по фиксированной цене. Другие совмещают его с репетитором, оставляя живые занятия для отдельных тем. Начать можно с бесплатной диагностики и посмотреть, как подойдёт вашему ребёнку." },
  { q: "Почему это дешевле занятий с репетитором?", a: "Когда вы платите репетитору, вы платите за время человека. В тренажёре ИИ-репетитор отвечает и проверяет без очереди и расписания, поэтому практика не упирается в количество оплаченных часов, а цена остаётся фиксированной." },
  { q: "Гарантируете ли вы баллы на экзамене?", a: "Нет, и никто не может это честно гарантировать. Сервис помогает заниматься регулярно и понимать материал, а результат зависит от самого ученика." },
  { q: "Связан ли сервис с ФИПИ или Рособрнадзором?", a: "Нет. Это независимый учебный проект. Задания взяты из открытого банка ФИПИ, но официальным ресурсом ведомств сервис не является." },
  { q: "Спишутся ли деньги повторно?", a: "Нет. Оплата разовая на 30 дней, карту мы не сохраняем и ничего не списываем автоматически. Продлевать или нет, вы решаете сами." },
  { q: "Какие данные ребёнка вы собираете?", a: "Имя, возраст, почту, школьные данные для анкеты подготовки и историю занятий. Подробности в политике конфиденциальности, ссылка внизу страницы." },
  { q: "Что если ребёнку не подойдёт?", a: "Базовый тариф бесплатный, на нём можно пройти диагностику и попробовать сервис до оплаты. Если возникнут вопросы по оплате, напишите нам, ответим в течение одного дня." },
];

export default function ParentsView({ onNav }: { onNav: (v: View) => void }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [seo, setSeo] = useState(DEFAULT_SEO);

  useEffect(() => {
    loadActiveTariffs().then(setTariffs);
    loadSeoSettings().then(setSeo);
  }, []);

  useDocumentHead({
    title: "ЕГЭ·ПРО для родителей — подготовка к ЕГЭ с ИИ-репетитором",
    description: "Как ребёнок готовится к ЕГЭ на ЕГЭ·ПРО: диагностика, личный план, тысячи заданий и ИИ-репетитор каждый день по фиксированной цене. Чем это отличается от занятий с репетитором. Оплата картой или через СБП, без автопродления.",
    path: "/parents",
    ogImage: seo.ogImage,
  });

  const paid = tariffs.filter((t) => t.priceRub > 0);
  const minPrice = paid.length ? rubles(Math.min(...paid.map((t) => t.salePriceRub ?? t.priceRub))) : "";

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="mt-8 sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">для родителей</p>
        <h1 className="font-display mt-2 text-2xl font-black leading-tight sm:text-4xl">Подготовка к ЕГЭ, которую можно позволить себе каждый месяц</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">
          ЕГЭ·ПРО — тренажёр для самостоятельной подготовки к ЕГЭ с ИИ-репетитором. Ребёнок занимается в удобное время с телефона или компьютера, а вы платите фиксированную сумму за 30 дней, картой или через СБП, и сами решаете, продлевать или нет.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-blue px-5 py-2.5 text-[13.5px]">Начать бесплатно</button>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ink px-5 py-2.5 text-[13.5px]">Посмотреть тарифы</button>
        </div>
      </div>

            <h2 className="font-display mt-12 text-xl font-black">Репетитор и ЕГЭ·ПРО: в чём разница</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink2">Что ребёнок получает за фиксированную сумму в месяц и чем это отличается от разовых занятий.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-2 border-ink text-left text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="w-[18%] bg-ink px-3 py-2.5 font-bold" />
              <th scope="col" className="w-[36%] bg-ink px-3 py-2.5 font-bold text-paper/80">Живой репетитор</th>
              <th scope="col" className="w-[46%] bg-blue px-3 py-2.5 font-bold text-white">ЕГЭ·ПРО</th>
            </tr>
          </thead>
          <tbody>
            {VS.map((v, idx) => (
              <tr key={v.row} className={idx % 2 ? "bg-ink/[0.04]" : "bg-sheet"}>
                <th scope="row" className="px-3 py-3 align-top font-bold">{v.row}</th>
                <td className="px-3 py-3 align-top leading-relaxed text-ink2">{v.tutor}</td>
                <td className="bg-blue/[0.07] px-3 py-3 align-top font-medium leading-relaxed text-ink">
                  <span className="flex items-start gap-2">
                    <Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />
                    <span>{v.us(minPrice)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display mt-12 text-xl font-black">Как проходят занятия</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <li key={s.t} className="sheet p-5">
            <p className="font-display text-2xl font-black text-blue">{i + 1}</p>
            <h3 className="font-display mt-1 text-[16px] font-black">{s.t}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{s.d}</p>
          </li>
        ))}
      </ol>

      {paid.length > 0 && (
        <>
          <h2 className="font-display mt-12 text-xl font-black">Тарифы</h2>
          <p className="mt-1 text-[13.5px] text-ink2">Базовый тариф бесплатный: диагностика и несколько обращений к ИИ-репетитору в день. Платные тарифы снимают лимит и добавляют предметы.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {paid.map((t) => (
              <div key={t.id} className="sheet p-5">
                <h3 className="font-display text-[16px] font-black">{t.name}</h3>
                <p className="font-display mt-1 text-2xl font-black">{rubles(t.salePriceRub ?? t.priceRub)}</p>
                <p className="font-mono text-[11.5px] text-ink2">на 30 дней · {t.subjectsCount} {plural(t.subjectsCount, "предмет", "предмета", "предметов")}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-ink2">Оплата разовая на 30 дней, без автопродления. Чек приходит на вашу почту, тариф включается сразу.</p>
        </>
      )}

      <h2 className="font-display mt-12 text-xl font-black">Как оплатить за ребёнка</h2>
      <ol className="mt-4 space-y-3 text-[14px] leading-relaxed text-ink2">
        <li className="flex gap-3"><span className="font-display font-black text-blue">1</span>Ребёнок регистрируется на сайте сам: у него будет свой аккаунт с занятиями и планом.</li>
        <li className="flex gap-3"><span className="font-display font-black text-blue">2</span>В разделе «Тарифы» он нажимает «Попросить родителя оплатить» и отправляет вам ссылку в мессенджере или письмом.</li>
        <li className="flex gap-3"><span className="font-display font-black text-blue">3</span>Вы открываете ссылку без входа в аккаунт, выбираете тариф и платите картой или через СБП. Тариф сразу включается ребёнку.</li>
      </ol>
      <div className="mt-5">
        <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="btn btn-ink px-5 py-2.5 text-[13px]">Зарегистрировать ученика</button>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { t: "Без автосписаний", d: "Платёж разовый. Карту мы не сохраняем и ничего не списываем сами." },
          { t: "Платёж защищён", d: "Оплата проходит на стороне ЮKassa, данные вашей карты мы не видим." },
          { t: "Доступ ограничен", d: "По ссылке видно только имя ребёнка и счётчики занятий, в его аккаунт она не пускает." },
        ].map((x) => (
          <div key={x.t} className="sheet flex items-start gap-3 p-4">
            <Icon name="check" size={18} className="mt-0.5 shrink-0 text-blue" />
            <div>
              <p className="font-display text-[14px] font-bold">{x.t}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{x.d}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-display mt-12 text-xl font-black">Частые вопросы</h2>
      <div className="mt-4 space-y-3">
        {FAQ.map((f) => (
          <div key={f.q} className="sheet p-4">
            <h3 className="font-display text-[14.5px] font-bold">{f.q}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink2">{f.a}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 text-[13px] text-ink2">
        Остались вопросы?{" "}
        <button onClick={() => onNav({ name: "contacts" })} className="link-slide font-bold hover:text-ink">Напишите нам</button>, ответим в течение одного дня. Подробнее:{" "}
        <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold hover:text-ink">публичная оферта</button>,{" "}
        <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold hover:text-ink">политика конфиденциальности</button>.
      </p>
    </div>
  );
}
