// Страница, куда ЮKassa возвращает браузер после оплаты (см. return_url в docker/api/payments.js,
// initiatePayment). Сам платёж к этому моменту чаще всего уже обработан вебхуком, но не всегда —
// поэтому здесь коротко поллим статус (см. lib/payments.ts), а не считаем оплату успешной по
// одному лишь факту возврата на этот адрес.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { getPaymentStatus, type PaymentKind, type PaymentStatus } from "../lib/payments";
import { trackPurchase } from "../lib/metrika";
import { Icon } from "./ui";
import type { View } from "./Header";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20; // ~40 секунд — заметно больше типичного времени доставки вебхука

export default function PaymentReturnView({ paymentId, onNav }: { paymentId: string; onNav: (v: View) => void }) {
  const { refreshProfile } = useAuth();
  const [status, setStatus] = useState<PaymentStatus | "timeout" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<PaymentKind>("tariff");
  const pollsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await getPaymentStatus(paymentId);
      if (cancelled) return;
      if (res.error) {
        setStatus("error");
        setErrorMsg(res.error);
        return;
      }
      if (res.status === "succeeded") {
        trackPurchase({ paymentId, amountRub: res.amountRub, tariffId: res.tariffId });
        if (res.kind) setKind(res.kind);
        setStatus("succeeded");
        await refreshProfile();
        return;
      }
      if (res.status === "canceled") {
        setStatus("canceled");
        return;
      }
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) {
        setStatus("timeout");
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      {status === "pending" && (
        <>
          <span className="flex h-12 w-12 items-center justify-center border-2 border-ink bg-hl text-ink mx-auto animate-pulse">
            <Icon name="timer" size={22} />
          </span>
          <h1 className="font-display mt-4 text-xl font-black">Проверяем оплату…</h1>
          <p className="mt-2 text-[13.5px] text-ink2">Обычно занимает несколько секунд — не закрывай страницу.</p>
        </>
      )}

      {status === "succeeded" && (
        <>
          <span className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-ink bg-hl text-ink">
            <Icon name="check" size={22} />
          </span>
          <h1 className="font-display mt-4 text-xl font-black">Оплата прошла успешно</h1>
          <p className="mt-2 text-[13.5px] text-ink2">
            {kind === "addon"
              ? "Предметы докуплены — подключи их в разделе «Мои предметы»."
              : kind === "renewal"
                ? "Тариф продлён, доступ ко всем твоим предметам восстановлен — можно продолжать подготовку."
                : "Тариф активирован — можно продолжать подготовку."}
          </p>
          <button onClick={() => onNav(kind === "addon" ? { name: "subjects" } : { name: "home" })} className="btn btn-blue mt-6 px-5 py-2.5 text-[13px]">
            {kind === "addon" ? "Выбрать предметы" : "Перейти в кабинет"}
          </button>
        </>
      )}

      {status === "canceled" && (
        <>
          <span className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-red bg-red/10 text-red">
            <Icon name="x" size={22} />
          </span>
          <h1 className="font-display mt-4 text-xl font-black">Оплата не прошла</h1>
          <p className="mt-2 text-[13.5px] text-ink2">Платёж отменён или отклонён банком — попробуй ещё раз или выбери другой способ оплаты.</p>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue mt-6 px-5 py-2.5 text-[13px]">
            Вернуться к тарифам
          </button>
        </>
      )}

      {status === "timeout" && (
        <>
          <span className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-amber bg-amber/10 text-amber">
            <Icon name="alert" size={22} />
          </span>
          <h1 className="font-display mt-4 text-xl font-black">Оплата обрабатывается дольше обычного</h1>
          <p className="mt-2 text-[13.5px] text-ink2">Если оплата прошла — тариф применится в течение нескольких минут. Обнови страницу тарифов чуть позже.</p>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue mt-6 px-5 py-2.5 text-[13px]">
            К тарифам
          </button>
        </>
      )}

      {status === "error" && (
        <>
          <span className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-red bg-red/10 text-red">
            <Icon name="alert" size={22} />
          </span>
          <h1 className="font-display mt-4 text-xl font-black">Не удалось проверить статус оплаты</h1>
          <p className="mt-2 text-[13.5px] text-ink2">{errorMsg ?? "Попробуй обновить страницу через минуту."}</p>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-blue mt-6 px-5 py-2.5 text-[13px]">
            К тарифам
          </button>
        </>
      )}
    </div>
  );
}
