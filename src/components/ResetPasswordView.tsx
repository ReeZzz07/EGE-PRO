// Страница, куда ведёт ссылка из письма сброса пароля (см. docker/api/mailer.js
// sendPasswordResetEmail, POST /auth/reset-password). Токен уже у нас в URL — здесь только форма
// нового пароля, сама проверка токена происходит на сервере при отправке формы, не заранее.
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Icon } from "./ui";
import type { View } from "./Header";

export default function ResetPasswordView({ token, onNav }: { token: string; onNav: (v: View) => void }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 6) return setError("Пароль должен быть не короче 6 символов.");
    if (password !== confirmPassword) return setError("Пароли не совпадают.");
    setBusy(true);
    const res = await resetPassword(token, password);
    setBusy(false);
    if (res.error) return setError(res.error);
    setDone(true);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="sheet p-6 sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
          <Icon name="star" size={20} />
        </span>
        <h1 className="font-display mt-4 text-xl font-bold">Новый пароль</h1>

        {done ? (
          <>
            <p className="mt-3 flex items-center gap-2 text-[13.5px] leading-relaxed text-ink2">
              <Icon name="check" size={16} className="shrink-0 text-blue" />
              Пароль обновлён — ты уже вошёл(шла) в аккаунт.
            </p>
            <button onClick={() => onNav({ name: "home" })} className="btn btn-blue mt-5 w-full px-5 py-3 text-sm">
              В личный кабинет
            </button>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">Придумай новый пароль для входа.</p>
            <div className="mt-5 space-y-3">
              <div>
                <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Новый пароль</label>
                <div className="relative mt-1.5">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? "text" : "password"}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
                    placeholder="Минимум 6 символов"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-ink2 hover:text-ink"
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
                  </button>
                </div>
              </div>
              <div>
                <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Повтори пароль</label>
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  type={showPassword ? "text" : "password"}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
                  placeholder="Ещё раз тот же пароль"
                />
              </div>
            </div>

            {error && (
              <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
                <Icon name="alert" size={15} /> {error}
              </p>
            )}

            <button onClick={submit} disabled={busy} className="btn btn-blue mt-5 w-full px-5 py-3 text-sm">
              {busy ? "Секунду…" : "Сохранить пароль"}
              {!busy && <Icon name="arrowR" size={16} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
