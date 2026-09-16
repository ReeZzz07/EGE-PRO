// Страница, куда ведёт ссылка из письма подтверждения (см. docker/api/mailer.js sendVerifyEmail,
// POST /auth/verify-email). Токен уже у нас в URL, но подтверждение — по явному клику на кнопку,
// а не сразу при открытии страницы: некоторые корпоративные антифишинг-сканеры (Outlook Safe Links
// и т.п.) сами открывают все ссылки из письма ещё до реального пользователя — если бы страница
// сама слала запрос при загрузке, одноразовый токен сгорал бы от сканера раньше настоящего клика.
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";
import type { View } from "./Header";

export default function VerifyEmailView({ token, onNav }: { token: string; onNav: (v: View) => void }) {
  const { verifyEmail } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setBusy(true);
    const res = await verifyEmail(token);
    setBusy(false);
    if (res.error) return setError(res.error);
    onNav({ name: "onboarding" });
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="sheet p-6 sm:p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
          <Icon name="check" size={20} />
        </span>
        <h1 className="font-display mt-4 text-xl font-bold">Подтверждение почты</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">Нажми кнопку, чтобы подтвердить email и войти в аккаунт.</p>

        {error && (
          <p className="anim-rise mt-4 flex items-center justify-center gap-2 text-[13px] font-bold text-red">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button onClick={confirm} disabled={busy} className="btn btn-blue mt-5 w-full px-5 py-3 text-sm">
          {busy ? "Секунду…" : "Подтвердить почту и войти"}
          {!busy && <Icon name="arrowR" size={16} />}
        </button>

        {error && (
          <button onClick={() => onNav({ name: "auth", mode: "login" })} className="link-slide mt-4 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
            Попробовать войти — там можно запросить новое письмо
          </button>
        )}
      </div>
    </div>
  );
}
