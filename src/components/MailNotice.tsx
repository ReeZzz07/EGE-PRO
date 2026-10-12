// Объявление «письма временно не приходят»: показывается на экранах регистрации, входа и «Подтверди почту», пока
// админ не выключит его в /admin → Почта (src/lib/mailNotice.ts). Нет объявления или сервер не ответил — ничего
// не рисуем, форма выглядит как обычно.
import { useEffect, useState } from "react";
import { loadPublicMailNotice } from "../lib/mailNotice";
import { Icon } from "./ui";

/** Сообщает родителю, есть ли активное объявление (экран «Подтверди почту» по нему прячет подсказки про «Спам»). */
export default function MailNotice({ onActive, className = "" }: { onActive?: (active: boolean) => void; className?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPublicMailNotice().then((n) => {
      if (!alive) return;
      setText(n.active ? n.text : null);
      onActive?.(n.active);
    });
    return () => {
      alive = false;
    };
    // onActive намеренно не в зависимостях: объявление читаем один раз на показ экрана
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!text) return null;
  return (
    <div role="status" data-testid="mail-notice" className={`border-2 border-amber bg-amber/10 p-3.5 text-left ${className}`}>
      <p className="flex items-center gap-2 text-[13px] font-bold text-ink">
        <Icon name="alert" size={15} /> Письма временно не приходят
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{text}</p>
    </div>
  );
}
