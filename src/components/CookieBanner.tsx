// Уведомление о том, что сайт использует cookie и Яндекс.Метрику. Не запрос разрешения — счётчик
// работает независимо от кнопки (см. main.tsx); «Понятно» подтверждает, что пользователь
// ознакомлен, и баннер больше не показывается (lib/cookieNotice.ts).
import { useState } from "react";
import { acknowledgeNotice, isNoticeAcknowledged } from "../lib/cookieNotice";
import type { View } from "./Header";

export default function CookieBanner({ onNav }: { onNav: (v: View) => void }) {
  const [visible, setVisible] = useState(() => !isNoticeAcknowledged());
  if (!visible) return null;

  return (
    <div role="region" aria-label="Уведомление об использовании cookie" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="sheet mx-auto flex max-w-3xl flex-col gap-3 border-2 border-ink p-4 shadow-lift sm:flex-row sm:items-center sm:gap-5">
        <p className="flex-1 text-[12.5px] leading-relaxed text-ink2">
          Сайт использует файлы cookie и локальное хранилище браузера (вход в аккаунт, настройки), а также сервис «Яндекс.Метрика» для статистики
          посещений.{" "}
          <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="underline decoration-dotted underline-offset-2 hover:text-ink">
            Политика конфиденциальности
          </button>
        </p>
        <button
          onClick={() => {
            acknowledgeNotice();
            setVisible(false);
          }}
          className="btn btn-blue shrink-0 px-5 py-2 text-[12.5px]"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
