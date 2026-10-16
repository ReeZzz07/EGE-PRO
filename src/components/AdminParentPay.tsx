// Блок «Оплата родителем» во вкладке «Источники»: сколько учеников создали ссылку для родителя, как ею поделились,
// сколько родителей открыли страницу, начали платить и заплатили (docker/api/parentPay.js).
import { useEffect, useState } from "react";
import { loadParentPayStats, type ParentPayStats } from "../lib/adminParentPay";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;

/** Подписи мест, откуда ученик нажал кнопку (PLACES в docker/api/parentPay.js). */
export const PLACE_LABEL: Record<string, string> = {
  tariffs: "Страница тарифов",
  "ai-limit": "Лимит ИИ-репетитора",
  "diagnostic-result": "Итог диагностики",
  "payment-canceled": "Отменённая оплата",
  reminder: "Плашка-напоминание на главной",
  paywall: "Блоки «это на платном тарифе»",
  other: "Другое",
};

export default function AdminParentPay({ from, to }: { from?: string; to?: string }) {
  const [s, setS] = useState<ParentPayStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadParentPayStats(from, to).then((r) => {
      if (!cancelled) setS(r);
    });
    return () => {
      cancelled = true;
    };
  }, [from, to]);
  if (!s) return null;
  const steps: [string, number, string?][] = [
    ["Ссылок создано", s.created],
    ["Поделились ссылкой", s.shared, `копирование ${s.shared_copy}, WhatsApp ${s.shared_whatsapp}, Telegram ${s.shared_telegram}`],
    ["Писем родителям отправлено", s.emails_sent, s.emails_failed ? `не дошли: ${s.emails_failed}` : undefined],
    ["Родители открыли страницу", s.opened],
    ["Начали оплату", s.pay_started],
    ["Оплатили", s.paid, s.paid ? money(s.revenue) : undefined],
    ["Напоминаний ученикам отправлено", s.reminders ?? 0, "письмом: родитель не открыл ссылку за сутки"],
  ];
  const places = s.places ?? [];
  return (
    <section aria-labelledby="at-parent">
      <h3 id="at-parent" className="font-display text-[15px] font-black">Оплата родителем</h3>
      <p className="mt-1 text-[12.5px] text-ink2">Ученик нажимает «Попросить родителя оплатить» и отправляет ссылку. Здесь видно, сколько таких ссылок дошло до оплаты.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([label, n, note]) => (
          <li key={label} className="border-2 border-ink/15 px-3 py-2 text-[13px]">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{label}</span>
              <span className="tabular-nums font-bold">{n}</span>
            </span>
            {note && <span className="mt-0.5 block text-[11.5px] text-ink2">{note}</span>}
          </li>
        ))}
      </ul>
      {places.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="parent-pay-places" className="w-full min-w-[420px] text-left text-[12.5px]">
            <caption className="pb-1 text-left text-[12.5px] font-bold">Откуда нажимают «Попросить родителя оплатить»</caption>
            <thead>
              <tr className="border-b-2 border-ink/15 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink2">
                <th className="py-1.5 pr-3 font-bold">Место</th>
                <th className="py-1.5 pr-3 text-right font-bold">Запросили</th>
                <th className="py-1.5 pr-3 text-right font-bold">Родитель открыл</th>
                <th className="py-1.5 text-right font-bold">Оплатили</th>
              </tr>
            </thead>
            <tbody>
              {places.map((p) => (
                <tr key={p.place ?? "none"} className="border-b border-ink/10">
                  <td className="py-1.5 pr-3">{PLACE_LABEL[p.place ?? "other"] ?? p.place}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.requested}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.opened}</td>
                  <td className="py-1.5 text-right tabular-nums font-bold">{p.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
