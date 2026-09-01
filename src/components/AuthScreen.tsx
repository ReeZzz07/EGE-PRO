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
  onSuccess: () => void;
  initialMode?: "signup" | "login";
  onNav: (v: View) => void;
}) {
  const { signUp, signIn, isGuestMode } = useAuth();
  const [mode, setMode] = useState<"signup" | "login">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (mode === "signup" && !name.trim()) return setError("Укажи имя — так к тебе будет обращаться репетитор.");
    if (!email.trim() || !password.trim()) return setError("Заполни email и пароль.");
    setBusy(true);
    const result = mode === "signup" ? await signUp(email.trim(), password, name.trim()) : await signIn(email.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
    else onSuccess();
  };

  return (
    <div className={compact ? "" : "mx-auto max-w-md px-4 py-16"}>
      <div className={compact ? "" : "sheet p-6 sm:p-8"}>
        {!compact && (
          <>
            <span className="flex h-11 w-11 items-center justify-center border-2 border-ink bg-ink text-hl">
              <Icon name="star" size={20} />
            </span>
            <h1 className="font-display mt-4 text-xl font-bold">{mode === "signup" ? "Создай профиль, чтобы сохранить план" : "С возвращением"}</h1>
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

        <div className="mt-5 space-y-3">
          {mode === "signup" && (
            <div>
              <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Имя</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" placeholder="Как к тебе обращаться" />
            </div>
          )}
          <div>
            <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" placeholder="mail@example.com" />
          </div>
          <div>
            <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Пароль</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
              placeholder="Минимум 6 символов"
            />
          </div>
        </div>

        {error && (
          <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button onClick={submit} disabled={busy} className="btn btn-blue mt-5 w-full px-5 py-3 text-sm">
          {busy ? "Секунду…" : mode === "signup" ? "Создать профиль" : "Войти"}
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

        <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }} className="link-slide mt-3 block text-center text-[12.5px] font-bold text-ink2 hover:text-ink">
          {mode === "signup" ? "Уже есть аккаунт? Войти" : "Впервые здесь? Создать профиль"}
        </button>

        {!isSupabaseConfigured && (
          <p className="mt-4 text-center text-[11px] text-ink2">Демо-режим не хранит настоящий пароль — просто продолжай под этим email.</p>
        )}
      </div>
    </div>
  );
}
