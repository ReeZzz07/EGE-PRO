// Поле «Куда отправлять тестовые письма» наверху вкладки «Почта» — общее для всех блоков ниже (см. lib/testRecipient.ts).
import { useAuth } from "../lib/auth";
import { setTestRecipient, useTestRecipient, useTestRecipientInput } from "../lib/testRecipient";

export default function TestRecipientField() {
  const { profile } = useAuth();
  const raw = useTestRecipientInput();
  const { valid } = useTestRecipient(profile?.email);
  return (
    <div className="sheet p-4 sm:p-5">
      <label htmlFor="test-recipient" className="font-display text-[15px] font-bold">
        Куда отправлять тестовые письма
      </label>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
        Пусто — на вашу почту{profile?.email ? <> (<span className="font-mono">{profile.email}</span>)</> : null}. Можно вписать любой другой адрес, например ящик на Gmail или Mail.ru, чтобы проверить, как письмо
        выглядит у получателя и не попадает ли в спам. Адрес запоминается в этом браузере.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="test-recipient"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={raw}
          onChange={(e) => setTestRecipient(e.target.value)}
          placeholder={profile?.email ?? "name@example.com"}
          aria-invalid={!valid}
          className="input-blank w-full max-w-sm rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
        />
        {raw.trim() && (
          <button type="button" onClick={() => setTestRecipient("")} className="btn btn-ghost px-3 py-2 text-[12px]">
            Сбросить на мою почту
          </button>
        )}
      </div>
      {!valid && (
        <p role="alert" className="mt-2 text-[12.5px] font-bold text-red">
          Проверьте адрес: он должен быть полным и написан латиницей, например ivan@gmail.com.
        </p>
      )}
    </div>
  );
}
