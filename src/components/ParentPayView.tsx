// Страница для родителя: сюда ведёт ссылка /pay-for/<токен>, которую отправил ученик (см. ParentPayModal.tsx,
// docker/api/parentPay.js). Родитель не входит в аккаунт: видит, что это за сервис и сколько стоит, выбирает
// тариф, указывает почту для чека и платит картой или через СБП. ?paymentId= — возврат после оплаты
// (ЮKassa возвращает сюда же): коротко проверяем статус и показываем итог.
import { useEffect, useRef, useState } from "react";
import { getParentPaymentStatus, loadParentView, rub, startParentPayment, type ParentPublicView, type ParentTariff, type PayMethod } from "../lib/parentPay";
import { reachGoal, reachGoalOnce, trackPurchase } from "../lib/metrika";
import { useDocumentHead } from "../lib/useDocumentHead";
import { plural } from "../lib/utils";
import { Icon } from "./ui";
import type { View } from "./Header";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20;

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 pb-20 pt-8 sm:pt-12">{children}</div>;
}

function Notice({ tone, title, children }: { tone: "ok" | "err" | "wait"; title: string; children?: React.ReactNode }) {
  const cls = tone === "ok" ? "border-ink bg-hl text-ink" : tone === "err" ? "border-red bg-red/10 text-red" : "border-ink bg-hl text-ink animate-pulse";
  return (
    <Shell>
      <div className="text-center">
        <span className={`mx-auto flex h-12 w-12 items-center justify-center border-2 ${cls}`}>
          <Icon name={tone === "ok" ? "check" : tone === "err" ? "alert" : "timer"} size={22} />
        </span>
        <h1 className="font-display mt-4 text-xl font-black">{title}</h1>
        <div className="mt-2 text-[13.5px] leading-relaxed text-ink2">{children}</div>
      </div>
    </Shell>
  );
}

function PaymentResult({ token, paymentId, onBack }: { token: string; paymentId: string; onBack: () => void }) {
  const [state, setState] = useState<"pending" | "succeeded" | "canceled" | "timeout" | "error">("pending");
  const [name, setName] = useState<string | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const r = await getParentPaymentStatus(token, paymentId);
      if (cancelled) return;
      if (r.error) return setState("error");
      if (r.studentName) setName(r.studentName);
      if (r.status === "succeeded") {
        trackPurchase({ paymentId, amountRub: r.amountRub, tariffId: r.tariffId });
        return setState("succeeded");
      }
      if (r.status === "canceled") return setState("canceled");
      polls.current += 1;
      if (polls.current >= MAX_POLLS) return setState("timeout");
      setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [token, paymentId]);

  if (state === "pending") return <Notice tone="wait" title="Проверяем оплату…">Обычно это занимает несколько секунд, не закрывайте страницу.</Notice>;
  if (state === "succeeded")
    return (
      <Notice tone="ok" title="Спасибо, оплата прошла">
        <p>Тариф уже включён{name ? ` у ${name}` : " у вашего ребёнка"}, можно продолжать подготовку. Чек придёт на указанную вами почту.</p>
      </Notice>
    );
  if (state === "canceled")
    return (
      <Notice tone="err" title="Оплата не прошла">
        <p>Платёж отменён или отклонён банком. Можно попробовать ещё раз или выбрать другой способ, например СБП.</p>
        <button onClick={onBack} className="btn btn-blue mt-5 px-5 py-2.5 text-[13px]">Попробовать ещё раз</button>
      </Notice>
    );
  if (state === "timeout")
    return (
      <Notice tone="err" title="Оплата обрабатывается дольше обычного">
        <p>Если деньги списались, тариф включится в течение нескольких минут. Если нет, напишите нам на support@ege-tutor.ru, и мы поможем.</p>
      </Notice>
    );
  return (
    <Notice tone="err" title="Не удалось проверить оплату">
      <p>Обновите страницу через минуту. Если деньги списались, тариф включится сам; если что-то не так, напишите на support@ege-tutor.ru.</p>
    </Notice>
  );
}

function priceBlock(t: ParentTariff) {
  const discounted = t.finalPrice < t.basePrice;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-display text-xl font-black">{rub(t.finalPrice)}</span>
      {discounted && <span className="font-mono text-[12.5px] text-ink2 line-through">{rub(t.basePrice)}</span>}
    </div>
  );
}

export default function ParentPayView({ token, paymentId, onNav }: { token: string; paymentId?: string; onNav: (v: View) => void }) {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ParentPublicView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<PayMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!paymentId);

  // страница не для поиска: ссылка личная, и показывать её в выдаче незачем
  useDocumentHead({ title: "Оплата подготовки к ЕГЭ — ЕГЭ·ПРО", description: "Оплата тарифа ЕГЭ·ПРО по просьбе ребёнка.", path: "/pay-for", noindex: true });

  useEffect(() => {
    let cancelled = false;
    loadParentView(token).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.notFound) return setNotFound(true);
      if (r.error || !r.view) return setProblem(r.error ?? "Не удалось загрузить страницу");
      setView(r.view);
      const tariffs = r.view.tariffs ?? [];
      setSelected((tariffs.find((t) => t.badge) ?? tariffs[0])?.id ?? null);
      if (!r.view.expired) reachGoalOnce(`parent_page:${token}`, "parent_page_opened", "forever");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (paymentId && !showForm) return <PaymentResult token={token} paymentId={paymentId} onBack={() => { setShowForm(true); onNav({ name: "parent-pay", token }); }} />;
  if (loading) return <Shell><p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p></Shell>;
  if (notFound) return <Notice tone="err" title="Ссылка не найдена">Проверьте, что она скопирована целиком, или попросите ребёнка отправить её ещё раз.</Notice>;
  if (problem) return <Notice tone="err" title="Страница не загрузилась">{problem}</Notice>;
  if (!view || view.expired) return <Notice tone="err" title="Срок действия ссылки истёк">Ссылка действует 14 дней. Попросите ребёнка нажать «Попросить родителя оплатить» ещё раз, и придёт новая.</Notice>;

  const tariffs = view.tariffs ?? [];
  const who = view.studentName ?? "Ваш ребёнок";
  const pay = async (method: PayMethod) => {
    if (!selected) return;
    setBusy(method);
    setError(null);
    const r = await startParentPayment(token, { tariffId: selected, email: email.trim(), method });
    if (r.error || !r.confirmationUrl) {
      setBusy(null);
      return setError(r.error ?? "Не удалось создать платёж");
    }
    const url = r.confirmationUrl;
    reachGoal("parent_pay_start", { tariff: selected, method }, () => {
      window.location.href = url;
    });
  };
  const progress = [
    view.tasksSolved ? `решено ${view.tasksSolved} ${plural(view.tasksSolved, "задание", "задания", "заданий")}` : null,
    view.diagnosticDone ? "пройдена диагностика уровня" : null,
  ].filter(Boolean);

  return (
    <Shell>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-blue">оплата по просьбе ребёнка</p>
      <h1 className="font-display mt-2 text-2xl font-black leading-tight sm:text-3xl">{who} просит помочь с оплатой подготовки к ЕГЭ</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink2">
        ЕГЭ·ПРО — тренажёр для подготовки к ЕГЭ с ИИ-репетитором: он объясняет задачи по шагам, а не решает за ученика. Задания взяты из открытого банка ФИПИ. Это учебный проект, он не связан с ФИПИ и Рособрнадзором.
      </p>
      {progress.length > 0 && (
        <p className="mt-3 border-l-4 border-blue bg-blue/8 px-4 py-3 text-[13.5px] text-ink">
          <strong>Уже сделано:</strong> {progress.join(", ")}.
        </p>
      )}

      <h2 className="font-display mt-8 text-lg font-black">Выберите тариф</h2>
      {view.discountPercent ? (
        <p className="mt-1 text-[13px] text-ink2">
          Для {view.studentName ?? "вашего ребёнка"} действует скидка −{view.discountPercent}% на первую оплату
          {view.discountUntil ? ` (до ${new Date(view.discountUntil).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })})` : ""}.
        </p>
      ) : null}
      <div role="radiogroup" aria-label="Тариф" className="mt-3 space-y-3">
        {tariffs.map((t) => (
          <label key={t.id} className={`sheet flex cursor-pointer items-start gap-3 p-4 ${selected === t.id ? "outline outline-[3px] outline-blue" : ""}`}>
            <input type="radio" name="tariff" value={t.id} checked={selected === t.id} onChange={() => setSelected(t.id)} className="mt-1.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-display text-[15px] font-black">{t.name}{t.badge ? <span className="ml-2 rounded-sm bg-hl px-1.5 py-0.5 font-mono text-[10.5px] font-bold">{t.badge}</span> : null}</span>
                {priceBlock(t)}
              </span>
              <span className="mt-1 block font-mono text-[11.5px] text-ink2">на 30 дней · {t.subjectsCount} {plural(t.subjectsCount, "предмет", "предмета", "предметов")}{t.dailyAiLimit == null ? " · безлимитный ИИ-репетитор" : ""}</span>
              {t.features.length > 0 && (
                <ul className="mt-2 space-y-1 text-[12.5px] text-ink2">
                  {t.features.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5"><Icon name="check" size={13} className="mt-0.5 shrink-0 text-blue" />{f}</li>
                  ))}
                </ul>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-6">
        <label htmlFor="parent-receipt-email" className="text-[13.5px] font-bold">Ваша почта для чека</label>
        <input
          id="parent-receipt-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="mama@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full border-2 border-ink bg-white px-3 py-2.5 text-[14px]"
        />
        <p className="mt-1 text-[12px] text-ink2">Чек об оплате придёт на этот адрес. Больше мы ничего на него не отправляем.</p>
      </div>

      {error && <p role="alert" className="mt-4 border-l-4 border-red bg-red/10 px-3 py-2 text-[13px] text-red">{error}</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button onClick={() => pay("card")} disabled={!selected || !email.trim() || busy !== null} className="btn btn-blue justify-center px-5 py-3 text-[14px]">
          {busy === "card" ? "Открываем оплату…" : "Оплатить картой"}
        </button>
        <button onClick={() => pay("sbp")} disabled={!selected || !email.trim() || busy !== null} className="btn btn-ink justify-center px-5 py-3 text-[14px]">
          {busy === "sbp" ? "Открываем оплату…" : "Оплатить через СБП"}
        </button>
      </div>

      <ul className="mt-8 space-y-2.5 text-[13px] leading-relaxed text-ink2">
        <li className="flex items-start gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />Платёж разовый, на 30 дней. Автопродления нет, карту мы не сохраняем.</li>
        <li className="flex items-start gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />Оплата проходит на стороне ЮKassa, данные карты мы не видим.</li>
        <li className="flex items-start gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />Тариф включается ребёнку сразу после оплаты.</li>
        <li className="flex items-start gap-2"><Icon name="check" size={15} className="mt-0.5 shrink-0 text-blue" />Родитель видит только имя ребёнка и счётчики занятий, в аккаунт зайти нельзя.</li>
      </ul>

      <p className="mt-6 text-[12px] leading-relaxed text-ink2">
        Нажимая «Оплатить», вы соглашаетесь с{" "}
        <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold hover:text-ink">публичной офертой</button> и{" "}
        <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold hover:text-ink">политикой конфиденциальности</button>.
        Вопросы по оплате: <a href="mailto:support@ege-tutor.ru" className="link-slide font-bold hover:text-ink">support@ege-tutor.ru</a>, отвечаем в течение одного дня.
      </p>
    </Shell>
  );
}
