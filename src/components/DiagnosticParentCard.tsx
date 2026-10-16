// Блок на экране «твой результат» после диагностики: самый первый момент, когда платформа уже дала ученику результат,
// а на бесплатном тарифе его слабые темы упрутся в лимит ИИ. Если своей карты нет, тариф может оплатить родитель.
// Показывается только ученику на бесплатном тарифе (не админу и не гостевому режиму); кнопка — ParentPayLink.tsx.
import { useAuth } from "../lib/auth";
import ParentPayLink from "./ParentPayLink";

export default function DiagnosticParentCard() {
  const { profile, isGuestMode } = useAuth();
  if (!profile || profile.isAdmin || isGuestMode || profile.tariffId !== "free") return null;
  return (
    <div data-testid="diag-parent" className="mt-6 border-2 border-blue/40 bg-blue/5 p-4">
      <p className="font-display text-[15px] font-black">Хочешь разбирать эти темы без лимита?</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">
        На бесплатном тарифе ИИ-репетитор отвечает три раза в день. Если у тебя нет своей карты, тариф может оплатить родитель по ссылке: картой или через СБП.
      </p>
      <ParentPayLink place="diagnostic-result" label="Попросить родителя оплатить" className="btn btn-ghost mt-3 px-4 py-2 text-[13px]" />
    </div>
  );
}
