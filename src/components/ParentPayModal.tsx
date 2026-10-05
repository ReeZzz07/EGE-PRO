// «Попросить родителя оплатить» — окно для ученика: ссылка на страницу оплаты для родителя (/pay-for/…)
// и три способа её отправить: скопировать/переслать в мессенджере или письмом с нашего адреса.
// Серверная часть — docker/api/parentPay.js; страница, на которую попадёт родитель, — ParentPayView.tsx.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { reachGoal } from "../lib/metrika";
import { createParentLink, emailParent, markParentLinkShared, parentShareText, telegramShareUrl, whatsappShareUrl, type ShareChannel } from "../lib/parentPay";
import { Icon, useToast } from "./ui";

export default function ParentPayModal({ onClose, place }: { onClose: () => void; place: string }) {
  const { profile } = useAuth();
  const { push } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [emailDone, setEmailDone] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createParentLink().then((r) => {
      if (cancelled) return;
      if (r.url) setUrl(r.url);
      else setError(r.error ?? "Не удалось создать ссылку");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = profile?.name?.trim().split(/\s+/)[0] ?? null;
  const text = url ? parentShareText(url, firstName) : "";

  const shared = (channel: ShareChannel) => {
    markParentLinkShared(channel);
    reachGoal("parent_link_shared", { channel, place });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(text);
      push("Сообщение со ссылкой скопировано — вставь его родителю в любой чат", "ok");
      shared("copy");
    } catch {
      push("Не получилось скопировать — выдели ссылку вручную и скопируй", "err");
    }
  };

  const sendEmail = async () => {
    setSending(true);
    setEmailError(null);
    const r = await emailParent(email.trim());
    setSending(false);
    if (r.error) return setEmailError(r.error);
    setEmailDone(true);
    reachGoal("parent_email_sent", { place });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="parent-pay-title" className="sheet max-h-[90vh] w-full max-w-lg overflow-y-auto border-2 border-ink p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-blue">платит родитель</p>
            <h2 id="parent-pay-title" className="font-display mt-1 text-xl font-black leading-tight">Попросить родителя оплатить</h2>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="btn btn-ghost shrink-0 px-2.5 py-1.5 text-[12px]">
            <Icon name="x" size={14} />
          </button>
        </div>

        <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
          Отправь родителю ссылку. Он откроет её без входа в аккаунт, выберет тариф и оплатит картой или через СБП, а тариф включится тебе. Чек придёт ему на почту.
        </p>

        {error && <p role="alert" className="mt-4 border-l-4 border-red bg-red/10 px-3 py-2 text-[13px] text-red">{error}</p>}
        {!url && !error && <p className="mt-4 font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Готовим ссылку…</p>}

        {url && (
          <>
            <div className="mt-4 border-2 border-ink bg-paper p-3">
              <p className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-ink2">Что получит родитель</p>
              <p data-testid="parent-share-text" className="mt-1.5 text-[13px] leading-relaxed text-ink">{text}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button onClick={copy} className="btn btn-blue justify-center px-3 py-2.5 text-[13px]">
                <Icon name="link" size={15} /> Скопировать
              </button>
              <a
                href={whatsappShareUrl(text)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => shared("whatsapp")}
                className="btn btn-ink justify-center px-3 py-2.5 text-[13px]"
              >
                WhatsApp
              </a>
              <a
                href={telegramShareUrl(url, text)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => shared("telegram")}
                className="btn btn-ink justify-center px-3 py-2.5 text-[13px]"
              >
                Telegram
              </a>
            </div>

            <div className="mt-5 border-t-2 border-ink/15 pt-4">
              <label htmlFor="parent-email" className="text-[13px] font-bold text-ink">Или отправить письмом</label>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">
                Мы отправим родителю одно письмо с твоим именем, твоим прогрессом и этой ссылкой. Адрес мы не сохраняем и ничего больше на него не пишем.
              </p>
              {emailDone ? (
                <p role="status" className="mt-2 border-l-4 border-green bg-green/10 px-3 py-2 text-[13px] text-ink">Письмо отправлено. Если родитель его не нашёл, пусть проверит «Спам».</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="parent-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="mama@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="min-w-0 flex-1 border-2 border-ink bg-white px-3 py-2 text-[13.5px]"
                  />
                  <button onClick={sendEmail} disabled={sending || !email.trim()} className="btn btn-ink justify-center px-4 py-2 text-[13px]">
                    {sending ? "Отправляем…" : "Отправить"}
                  </button>
                </div>
              )}
              {emailError && <p role="alert" className="mt-2 text-[12.5px] text-red">{emailError}</p>}
            </div>
          </>
        )}

        <p className="mt-4 text-[11.5px] leading-relaxed text-ink2">Ссылка действует 14 дней. По ней можно только оплатить тариф тебе, больше родитель ничего в твоём аккаунте не увидит.</p>
      </div>
    </div>
  );
}
