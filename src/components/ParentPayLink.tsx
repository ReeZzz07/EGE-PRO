// Ссылка/кнопка «Нет карты? Попросить родителя оплатить» в любом месте платформы, где ученик упёрся в платное
// (лимит ИИ, итог диагностики…). Открывает ParentPayModal; place уходит на сервер и попадает в статистику админки
// («откуда нажимают», docker/api/parentPay.js). Админам и гостевому режиму не показывается: у них нет оплаты.
import { useState } from "react";
import { useAuth } from "../lib/auth";
import ParentPayModal from "./ParentPayModal";

export default function ParentPayLink({ place, className = "", label = "Нет карты? Попросить родителя оплатить" }: { place: string; className?: string; label?: string }) {
  const { profile, isGuestMode } = useAuth();
  const [open, setOpen] = useState(false);
  if (!profile || profile.isAdmin || isGuestMode) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && <ParentPayModal place={place} onClose={() => setOpen(false)} />}
    </>
  );
}
