/** Блок доверия у оплаты (DEV brief 3 / аудит): родитель, 30 дней, чек, СБП. */
export default function PaymentTrustBlock({ className = "" }: { className?: string }) {
  return (
    <ul className={`grid gap-2 text-[12.5px] leading-relaxed text-ink2 sm:grid-cols-3 ${className}`}>
      <li className="border-2 border-ink/15 bg-paper px-3 py-2.5">
        <strong className="text-ink">Оплатить может родитель</strong>
        <span className="mt-0.5 block">Отправь ссылку — он заплатит без входа в твой аккаунт, картой или через СБП.</span>
      </li>
      <li className="border-2 border-ink/15 bg-paper px-3 py-2.5">
        <strong className="text-ink">30 дней, без автосписаний</strong>
        <span className="mt-0.5 block">Разовая оплата. Карту не сохраняем, сами ничего не продлеваем.</span>
      </li>
      <li className="border-2 border-ink/15 bg-paper px-3 py-2.5">
        <strong className="text-ink">Чек на почту</strong>
        <span className="mt-0.5 block">После оплаты чек придёт плательщику. Доступ включится сразу.</span>
      </li>
    </ul>
  );
}
