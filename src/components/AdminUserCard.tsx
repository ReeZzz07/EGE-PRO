// Блоки карточки пользователя в админке: воронка по шагам, активность и платежи, и модальное окно,
// в котором открывается карточка из таблицы (см. AdminUsersTable.tsx). Сами поля правки/действия —
// в UserDetailPanel (AdminUsers.tsx).
import { useEffect, useRef, type ReactNode } from "react";
import type { AdminUserDetail } from "../lib/adminUsers";
import { Icon } from "./ui";

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABELS: Record<string, { text: string; cls: string }> = {
  succeeded: { text: "оплачен", cls: "border-teal bg-teal/10 text-teal" },
  pending: { text: "не завершён", cls: "border-amber bg-amber/10 text-amber" },
  canceled: { text: "отменён", cls: "border-red bg-red/10 text-red" },
};
const KIND_LABELS: Record<string, string> = { tariff: "тариф", renewal: "продление", addon: "докупка предметов" };

/** Воронка пользователя по шагам — те же условия, что фильтры списка, с датой достижения каждого. */
export function FunnelSteps({ detail }: { detail: AdminUserDetail }) {
  const firstPaid = detail.payments.filter((p) => p.status === "succeeded").map((p) => p.created_at).sort()[0] ?? null;
  const steps: { label: string; at: string | null }[] = [
    { label: "Регистрация", at: detail.registered_at },
    { label: "Почта подтверждена", at: detail.email_confirmed_at },
    { label: "Онбординг", at: detail.onboarded_at },
    { label: "Диагностика", at: detail.activity.diagnostics.first_at },
    { label: "Первая задача", at: detail.activity.attempts.first_at },
    { label: "Запрос к ИИ", at: detail.activity.ai.first_at },
    { label: "Оплата", at: firstPaid },
  ];
  return (
    <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Воронка пользователя">
      {steps.map((st) => (
        <li key={st.label} className={`border-2 px-2.5 py-2 ${st.at ? "border-teal/50 bg-teal/8" : "border-dashed border-ink/20 bg-paper"}`}>
          <p className={`flex items-center gap-1 text-[11.5px] font-bold leading-tight ${st.at ? "text-teal" : "text-ink2"}`}>
            <Icon name={st.at ? "check" : "x"} size={11} /> {st.label}
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-ink2">{st.at ? fmtDate(st.at) : "не было"}</p>
        </li>
      ))}
    </ol>
  );
}

export function ActivitySection({ detail }: { detail: AdminUserDetail }) {
  const a = detail.activity;
  const succeeded = detail.payments.filter((p) => p.status === "succeeded").length;
  const tiles = [
    { label: "Попыток решения", value: a.attempts.count, sub: a.attempts.last_at ? `последняя ${fmtDate(a.attempts.last_at)}` : "ещё не решал" },
    { label: "Диагностик", value: a.diagnostics.count, sub: a.diagnostics.first_at ? `первая ${fmtDate(a.diagnostics.first_at)}` : "не проходил" },
    { label: "Запросов к ИИ", value: a.ai.count, sub: a.ai.first_at ? `первый ${fmtDate(a.ai.first_at)}` : "не обращался" },
    { label: "Платежей", value: detail.payments.length, sub: `успешных: ${succeeded}` },
  ];
  return (
    <div className="mt-4">
      <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Активность и платежи</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="border-2 border-ink/15 px-3 py-2">
            <p className="font-display text-xl font-black leading-none tabular-nums">{t.value}</p>
            <p className="mt-1 text-[11.5px] font-bold">{t.label}</p>
            <p className="font-mono text-[10.5px] text-ink2">{t.sub}</p>
          </div>
        ))}
      </div>
      {detail.payments.length > 0 && (
        <div className="mt-3 overflow-x-auto border-2 border-ink/15">
          <table className="w-full min-w-[420px] text-left text-[12px]">
            <thead className="bg-sheet font-mono text-[10px] uppercase tracking-[0.14em] text-ink2">
              <tr>
                <th className="px-3 py-1.5">Когда</th>
                <th className="px-3 py-1.5">Что</th>
                <th className="px-3 py-1.5 text-right">Сумма</th>
                <th className="px-3 py-1.5">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {detail.payments.map((p) => {
                const st = STATUS_LABELS[p.status] ?? { text: p.status, cls: "border-ink/20 text-ink2" };
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{fmtDateTime(p.created_at)}</td>
                    <td className="px-3 py-1.5">
                      {p.tariff_id} · {KIND_LABELS[p.kind] ?? p.kind}
                      {p.extra_subjects > 0 ? ` (+${p.extra_subjects})` : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{Number(p.amount_rub).toLocaleString("ru-RU")} ₽</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${st.cls}`}>{st.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Модальное окно карточки: закрывается по Esc, клику на фон и крестику; фон под ним не прокручивается. */
export function UserModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-night/70 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Карточка пользователя" className="anim-rise relative my-2 w-full max-w-4xl border-2 border-ink bg-white shadow-[6px_6px_0_0_rgba(21,23,46,0.9)]">
        <button ref={closeRef} onClick={onClose} aria-label="Закрыть карточку" className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center border-2 border-ink bg-hl transition hover:bg-hl/70">
          <Icon name="x" size={14} />
        </button>
        {children}
      </div>
    </div>
  );
}
