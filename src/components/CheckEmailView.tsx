// Экран сразу после регистрации (см. AuthScreen.tsx) — вместо мгновенного входа. Аккаунт создан,
// но нерабочий, пока не пройти по ссылке из письма (см. VerifyEmailView.tsx, POST
// /auth/verify-email в docker/api/server.js).
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";
import type { View } from "./Header";

export default function CheckEmailView({ email, onNav }: { email: string; onNav: (v: View) => void }) {
  const { resendVerification } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setError(null);
    setBusy(true);
    const res = await resendVerification(email);
    setBusy(false);
    if (res.error) setError(res.error);
    else setSent(true);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="sheet p-6 sm:p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
          <Icon name="send" size={20} />
        </span>
        <h1 className="font-display mt-4 text-xl font-bold">Подтверди почту</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
          Мы отправили письмо со ссылкой на <strong className="text-ink">{email}</strong>. Перейди по ней, чтобы войти и продолжить регистрацию — заглянь
          и в папку «Спам», если письмо не пришло за пару минут.
        </p>

        {sent && (
          <p className="anim-rise mt-4 flex items-center justify-center gap-2 text-[13px] font-bold text-blue">
            <Icon name="check" size={15} /> Письмо отправлено повторно
          </p>
        )}
        {error && (
          <p className="anim-rise mt-4 flex items-center justify-center gap-2 text-[13px] font-bold text-red">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button onClick={resend} disabled={busy} className="btn btn-ghost mt-5 w-full px-5 py-2.5 text-sm">
          {busy ? "Секунду…" : "Отправить письмо ещё раз"}
        </button>
        <button onClick={() => onNav({ name: "auth", mode: "login" })} className="link-slide mt-4 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
          Уже подтвердил(а) на другом устройстве? Войти
        </button>
      </div>
    </div>
  );
}
