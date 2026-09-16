import { useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { Icon } from "./ui";
import type { View } from "./Header";

export default function AuthScreen({
  compact = false,
  onSuccess,
  initialMode = "signup",
  onNav,
}: {
  compact?: boolean;
  /** какой режим реально сработал — пользователь мог открыть форму как вход, но переключиться
   *  на регистрацию (и наоборот) до отправки, initialMode тут не подскажет */
  onSuccess: (mode: "signup" | "login") => void;
  initialMode?: "signup" | "login";
  onNav: (v: View) => void;
}) {
  const { signUp, signIn, forgotPassword, isGuestMode } = useAuth();
  const [mode, setMode] = useState<"signup" | "login" | "forgot">(initialMode);
  const [forgotSent, setForgotSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (mode === "forgot") {
      if (!email.trim()) return setError("Введи email.");
      setBusy(true);
      const result = await forgotPassword(email.trim());
      setBusy(false);
      if (result.error) setError(result.error);
      else setForgotSent(true);
      return;
    }
    if (mode === "signup" && !name.trim()) return setError("Укажи имя — так к тебе будет обращаться репетитор.");
    if (!email.trim() || !password.trim()) return setError("Заполни email и пароль.");
    if (mode === "signup" && password !== confirmPassword) return setError("Пароли не совпадают.");
    setBusy(true);
    const result = mode === "signup" ? await signUp(email.trim(), password, name.trim()) : await signIn(email.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
    else onSuccess(mode);
  };

  return (
    <div className={compact ? "" : "mx-auto max-w-md px-4 py-16"}>
      <div className={compact ? "" : "sheet p-6 sm:p-8"}>
        {!compact && (
          <>
            <span className="flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
              <Icon name="star" size={20} />
            </span>
            <h1 className="font-display mt-4 text-xl font-bold">
              {mode === "signup" ? "Создай профиль, чтобы сохранить план" : mode === "forgot" ? "Восстановление пароля" : "С возвращением"}
            </h1>
          </>
        )}
        {mode === "signup" && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">Мы сохраним твой план подготовки, прогресс и результаты диагностики.</p>
        )}

        {isGuestMode && (
          <p className="mt-3 border-l-4 border-amber bg-amber/10 px-3 py-2 text-[12px] leading-relaxed text-ink2">
            <strong className="text-ink">Демо-режим:</strong> Supabase не подключён, поэтому это локальный гостевой профиль в этом браузере, без проверки пароля. Как только подключишь бэкенд (см. SETUP.md), заработают настоящие аккаунты.
          </p>
        )}

        {mode === "forgot" && forgotSent ? (
          <>
            <p className="mt-3 flex items-center gap-2 text-[13.5px] leading-relaxed text-ink2">
              <Icon name="check" size={16} className="shrink-0 text-blue" />
              Если такой email зарегистрирован — на него отправлено письмо со ссылкой для сброса пароля.
            </p>
            <button
              onClick={() => { setMode("login"); setForgotSent(false); setError(null); }}
              className="link-slide mt-4 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink"
            >
              Назад ко входу
            </button>
          </>
        ) : (
          <>
            <div className="mt-5 space-y-3">
              {mode === "signup" && (
                <div>
                  <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Имя</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" placeholder="Как к тебе обращаться" />
                </div>
              )}
              <div>
                <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  onKeyDown={(e) => e.key === "Enter" && mode === "forgot" && submit()}
                  className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
                  placeholder="mail@example.com"
                />
              </div>
              {mode !== "forgot" && (
                <div>
                  <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Пароль</label>
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
              )}
              {mode === "signup" && (
                <div>
                  <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Повтори пароль</label>
                  <div className="relative mt-1.5">
                    <input
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      onKeyDown={(e) => e.key === "Enter" && submit()}
                      className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
                      placeholder="Ещё раз тот же пароль"
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
              )}
            </div>

            {mode === "login" && (
              <button
                onClick={() => { setMode("forgot"); setError(null); }}
                className="link-slide mt-2 block text-right text-[12px] font-bold text-ink2 hover:text-ink"
              >
                Забыл(а) пароль?
              </button>
            )}

            {error && (
              <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
                <Icon name="alert" size={15} /> {error}
              </p>
            )}

            <button onClick={submit} disabled={busy} className="btn btn-blue mt-5 w-full px-5 py-3 text-sm">
              {busy ? "Секунду…" : mode === "signup" ? "Создать профиль" : mode === "forgot" ? "Отправить ссылку" : "Войти"}
              {!busy && <Icon name="arrowR" size={16} />}
            </button>

            {mode === "signup" && (
              <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink2">
                Создавая профиль, ты принимаешь{" "}
                <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold text-ink2 hover:text-ink">
                  публичную оферту
                </button>{" "}
                и{" "}
                <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold text-ink2 hover:text-ink">
                  политику конфиденциальности
                </button>
              </p>
            )}

            {mode === "forgot" ? (
              <button onClick={() => { setMode("login"); setError(null); }} className="link-slide mt-3 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
                Назад ко входу
              </button>
            ) : (
              <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); setConfirmPassword(""); }} className="link-slide mt-3 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
                {mode === "signup" ? "Уже есть аккаунт? Войти" : "Впервые здесь? Создать профиль"}
              </button>
            )}

            {!isSupabaseConfigured && (
              <p className="mt-4 text-center text-[11px] text-ink2">Демо-режим не хранит настоящий пароль — просто продолжай под этим email.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
