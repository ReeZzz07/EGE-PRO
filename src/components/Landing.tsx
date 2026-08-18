import { SUBJECTS, type Subject } from "../data/tasks";
import { Icon, Reveal } from "./ui";

const CAPABILITIES = [
  { icon: "target", t: "Диагностика уровня", d: "8–12 заданий — и понятно, с чего начинать." },
  { icon: "book", t: "Персональный план", d: "Что повторить сегодня, сколько тренироваться на неделе." },
  { icon: "list", t: "Задания формата ЕГЭ", d: "Открытый банк ФИПИ, мгновенная проверка по эталону." },
  { icon: "chat", t: "ИИ-объяснения без готовых ответов", d: "Наводит на решение вопросами, а не выдаёт результат." },
  { icon: "check", t: "Проверка сочинений и развёрнутых ответов", d: "По критериям, с чёткими баллами по каждому пункту." },
  { icon: "timer", t: "Пробные варианты", d: "Таймер, часть 1 и часть 2 — как на настоящем экзамене." },
];

export default function Landing({ onStart, onLogin }: { onStart: (subject?: Subject) => void; onLogin: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* ─── Блок 1: первый экран ─── */}
      <section className="mt-10 sm:mt-16">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-blue">● новый ученик</span>
          <button onClick={onLogin} className="link-slide text-[13px] font-bold text-ink2 hover:text-ink">
            Уже есть аккаунт? Войти
          </button>
        </div>
        <h1 className="font-display mt-4 max-w-3xl text-[9vw] font-black leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
          Подготовка к ЕГЭ с <span className="hl">ИИ-репетитором</span>, который объясняет, а не решает за тебя
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink2">
          Диагностика уровня, персональный план, задания из открытого банка ФИПИ, уровневые подсказки и проверка сочинений по критериям.
          Без списывания — с пониманием.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button onClick={() => onStart()} className="btn btn-blue px-6 py-3.5 text-sm">
            Определить свой уровень <Icon name="arrowR" size={17} />
          </button>
          <button onClick={() => onStart()} className="btn btn-ghost px-6 py-3.5 text-sm">
            Начать бесплатно
          </button>
        </div>
      </section>

      {/* ─── Блок 2: быстрый выбор предмета ─── */}
      <section className="mt-14">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">шаг 1</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">С какого предмета начнём?</h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] text-ink2">Скоро добавим остальные предметы. Начни с любого из пяти — дальше сможешь тренировать все.</p>
        </Reveal>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(SUBJECTS).map((s, i) => (
            <Reveal key={s.id} delay={i * 60}>
              <button onClick={() => onStart(s.id)} className="sheet card-lift group flex w-full items-center gap-3 p-4 text-left">
                <span className={`font-display flex h-11 w-11 shrink-0 items-center justify-center border-2 border-ink text-[12px] font-black ${s.color}`}>{s.short}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{s.name}</span>
                  <span className="block truncate text-[12px] text-ink2">{s.desc}</span>
                </span>
                <Icon name="arrowR" size={16} className="shrink-0 text-ink2 transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Блок 3: что умеет платформа ─── */}
      <section className="mt-16">
        <Reveal>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">что внутри</p>
          <h2 className="font-display mt-1 text-2xl font-black sm:text-3xl">Не решебник, а нормальная подготовка</h2>
        </Reveal>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.t} delay={i * 60}>
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
      <section className="mt-16">
        <Reveal>
          <div className="gridpaper-dark relative overflow-hidden border-2 border-night bg-night px-6 py-9 text-paper sm:px-10">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-hl">принцип платформы</span>
            <p className="font-display mt-3 max-w-2xl text-xl font-bold leading-snug sm:text-2xl">
              ИИ не решает за тебя, а помогает разобраться.
            </p>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-paper/70">
              Готовый ответ не выдаётся ни при каких условиях — только наводящие вопросы, уровневые подсказки и разбор похожих
              заданий. Так тренируется мышление, а не привычка списывать.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ─── Блок 5: методическая опора ─── */}
      <section className="mt-10">
        <Reveal>
          <p className="border-l-4 border-blue bg-blue/5 px-4 py-3 text-[13px] leading-relaxed text-ink2">
            <strong className="text-ink">Методическая опора:</strong> задания и критерии ориентируются на открытый банк заданий и
            демоверсии ФИПИ (fipi.ru). Учебный проект — не официальный ресурс ФИПИ или Рособрнадзора.
          </p>
        </Reveal>
      </section>

      {/* ─── Блок 6: финальный CTA ─── */}
      <section className="mt-14 pb-16 text-center">
        <Reveal>
          <h2 className="font-display mx-auto max-w-lg text-2xl font-black sm:text-3xl">Пройди диагностику и получи план подготовки</h2>
          <p className="mt-2 text-[13.5px] text-ink2">7–10 минут. Ошибаться нормально — так мы поймём, что повторить в первую очередь.</p>
          <button onClick={() => onStart()} className="btn btn-blue mx-auto mt-6 px-7 py-3.5 text-sm">
            Пройти диагностику <Icon name="arrowR" size={17} />
          </button>
        </Reveal>
      </section>
    </div>
  );
}
