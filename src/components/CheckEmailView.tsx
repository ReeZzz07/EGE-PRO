// Экран сразу после регистрации (см. AuthScreen.tsx) — вместо мгновенного входа. Аккаунт создан,
// но нерабочий, пока не пройти по ссылке из письма (см. VerifyEmailView.tsx, POST
// /auth/verify-email в docker/api/server.js).
// Здесь теряется заметная часть регистраций (особенно у Gmail — письмо уходит в «Спам»), поэтому экран делает всё,
// чтобы человек письмо нашёл: кнопка «Открыть почту» (для Gmail — поиск по всей почте), подсказка, как письмо выглядит,
// повторная отправка с таймером, возможность исправить адрес и написать нам.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { mailboxLink } from "../lib/mailboxLink";
import { reachGoalOnce } from "../lib/metrika";
import { Icon } from "./ui";
import type { View } from "./Header";

/** Сколько секунд после отправки письмо нельзя запросить снова: защита от спама себе и нам. */
const RESEND_COOLDOWN_S = 45;

export default function CheckEmailView({ email, onNav }: { email: string; onNav: (v: View) => void }) {
  const { resendVerification } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // первое письмо ушло только что — повторно просить его сразу бессмысленно
  const [wait, setWait] = useState(RESEND_COOLDOWN_S);
  const mailbox = mailboxLink(email);

  useEffect(() => {
    reachGoalOnce("check_email_seen", "check_email_seen");
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const resend = async () => {
    setError(null);
    setSent(false);
    setBusy(true);
    const res = await resendVerification(email);
    setBusy(false);
    if (res.error) setError(res.error);
    else {
      setSent(true);
      setWait(RESEND_COOLDOWN_S);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="sheet p-6 sm:p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
          <Icon name="send" size={20} />
        </span>
        <h1 className="font-display mt-4 text-xl font-bold">Подтверди почту</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
          Мы отправили письмо на <strong className="break-all text-ink">{email}</strong>. Открой его и нажми кнопку — аккаунт заработает, и можно будет сразу
          пройти диагностику.
        </p>

        {mailbox && (
          <a href={mailbox.url} target="_blank" rel="noopener noreferrer" className="btn btn-blue mt-5 w-full justify-center px-5 py-3 text-sm">
            {mailbox.label} <Icon name="arrowR" size={16} />
          </a>
        )}

        <div className="mt-5 border-2 border-dashed border-ink/25 p-3.5 text-left text-[12.5px] leading-relaxed text-ink2">
          <p className="font-bold text-ink">Письма нет больше пары минут?</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>
              Ищи письмо с темой <b>«Подтверди email — ЕГЭ·ПРО»</b>. Проверь папки «Спам», «Промоакции» и «Социальные сети».
            </li>
            <li>Если нашёл в спаме — нажми «Это не спам»: тогда следующие письма придут во «Входящие».</li>
            <li>Адрес с опечаткой? Зарегистрируйся заново с правильным.</li>
          </ul>
        </div>

        {sent && (
          <p className="anim-rise mt-4 flex items-center justify-center gap-2 text-[13px] font-bold text-blue">
            <Icon name="check" size={15} /> Письмо отправлено повторно
          </p>
        )}
        {error && (
          <p role="alert" className="anim-rise mt-4 flex items-center justify-center gap-2 text-[13px] font-bold text-red">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button onClick={resend} disabled={busy || wait > 0} className="btn btn-ghost mt-5 w-full px-5 py-2.5 text-sm disabled:opacity-60">
          {busy ? "Секунду…" : wait > 0 ? `Отправить ещё раз — через ${wait} с` : "Отправить письмо ещё раз"}
        </button>
        <button onClick={() => onNav({ name: "auth", mode: "signup" })} className="link-slide mt-4 block w-full text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
          Ошибся в адресе? Зарегистрироваться заново
        </button>
        <button onClick={() => onNav({ name: "auth", mode: "login" })} className="link-slide mt-2 block w-full text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
          Уже подтвердил(а) на другом устройстве? Войти
        </button>
        <button onClick={() => onNav({ name: "contacts", topic: "bug" })} className="link-slide mt-2 block w-full text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
          Письмо так и не пришло? Напиши нам
        </button>
      </div>
    </div>
  );
}
