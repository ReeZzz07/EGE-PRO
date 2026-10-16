// Плашка на главной: ученик отправил родителю ссылку на оплату больше суток назад, а родитель её так и не открыл.
// Самое частое место, где теряется оплата школьника (нет своей карты), поэтому напоминаем явно и даём отправить ещё раз.
// Статус ссылки — GET /parent-link/status (docker/api/parentPay.js); то же самое письмом уходит из lifecycle.js (parent_waiting).
import { useEffect, useState } from "react";
import { getParentLinkStatus, type ParentLinkStatus } from "../lib/parentPay";
import { reachGoalOnce } from "../lib/metrika";
import { Icon } from "./ui";
import ParentPayModal from "./ParentPayModal";

export default function ParentLinkReminder() {
  const [status, setStatus] = useState<ParentLinkStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getParentLinkStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (status?.state === "waiting") reachGoalOnce("parent_reminder_seen", "parent_reminder_seen");
  }, [status?.state]);

  if (status?.state !== "waiting") return null;
  const until = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : null;
  return (
    <>
      <div role="status" data-testid="parent-link-reminder" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-blue/40 bg-blue/5 p-4">
        <Icon name="send" size={18} className="shrink-0 text-blue" />
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-display text-[15px] font-black">Родитель ещё не открыл твою ссылку на оплату</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
            Напомни ему или отправь другим способом: в WhatsApp, Telegram или письмом.{until ? ` Ссылка действует до ${until}.` : ""}
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-blue shrink-0 px-4 py-2 text-[13px]">
          Отправить ещё раз
        </button>
      </div>
      {open && <ParentPayModal place="reminder" onClose={() => setOpen(false)} />}
    </>
  );
}
