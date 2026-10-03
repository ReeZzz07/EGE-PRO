// Настройка приветственной скидки на первую оплату (см. lib/offers.ts, docker/api/offers.js).
// Скидка складывается из трёх частей — за подтверждение почты, за онбординг и за диагностику; каждая
// часть открывается своим шагом. Действует на всех платных тарифах для тех, кто ещё ни разу не платил.
// Срок отсчитывается от самого позднего пройденного шага. Изменения применяются сразу — сервер читает
// настройки при каждой оплате.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { DEFAULT_WELCOME_OFFER_SETTINGS, loadWelcomeOfferSettings, saveWelcomeOfferSettings, MAX_TOTAL_OFFER_PERCENT } from "../lib/offers";
import { useToast } from "./ui";

const PARTS = [
  { field: "confirmPercent", label: "За подтверждение почты" },
  { field: "onboardingPercent", label: "За онбординг" },
  { field: "diagnosticPercent", label: "За диагностику" },
] as const;

type PartField = (typeof PARTS)[number]["field"];

export default function AdminWelcomeOffer() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULT_WELCOME_OFFER_SETTINGS.enabled);
  // поля чисел храним строками, чтобы можно было стереть значение и набрать новое
  const [partStr, setPartStr] = useState<Record<PartField, string>>({
    confirmPercent: String(DEFAULT_WELCOME_OFFER_SETTINGS.confirmPercent),
    onboardingPercent: String(DEFAULT_WELCOME_OFFER_SETTINGS.onboardingPercent),
    diagnosticPercent: String(DEFAULT_WELCOME_OFFER_SETTINGS.diagnosticPercent),
  });
  const [hoursStr, setHoursStr] = useState(String(DEFAULT_WELCOME_OFFER_SETTINGS.hours));

  useEffect(() => {
    loadWelcomeOfferSettings().then((s) => {
      setEnabled(s.enabled);
      setPartStr({ confirmPercent: String(s.confirmPercent), onboardingPercent: String(s.onboardingPercent), diagnosticPercent: String(s.diagnosticPercent) });
      setHoursStr(String(s.hours));
      setLoading(false);
    });
  }, []);

  const total = PARTS.reduce((sum, p) => sum + (Number(partStr[p.field]) || 0), 0);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveWelcomeOfferSettings(
      {
        enabled,
        hours: Number(hoursStr),
        confirmPercent: Number(partStr.confirmPercent),
        onboardingPercent: Number(partStr.onboardingPercent),
        diagnosticPercent: Number(partStr.diagnosticPercent),
      },
      profile.id
    );
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — действует со следующей оплаты", "ok");
  };

  if (loading) return null;

  return (
    <div className="sheet mt-6 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Приветственная скидка на первую оплату</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
        Скидка на любой платный тариф для тех, кто ещё ни разу не платил. Складывается из трёх частей: каждая открывается своим шагом — подтверждением
        почты, онбордингом и диагностикой. Срок отсчитывается от самого позднего пройденного шага (каждый новый шаг увеличивает скидку и заново открывает
        полный срок). Показывается плашкой с таймером на главной, на странице тарифов и в блоках «это на платном тарифе», применяется сама при оплате.
        Не суммируется с персональной скидкой из карточки пользователя — берётся большая.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Включена
        </label>
        {PARTS.map((p) => (
          <label key={p.field} className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">{p.label}, %</span>
            <input
              value={partStr[p.field]}
              onChange={(e) => setPartStr((s) => ({ ...s, [p.field]: e.target.value }))}
              inputMode="numeric"
              className="input-blank mt-1.5 block w-28 rounded-sm px-3 py-2 text-[13px]"
            />
          </label>
        ))}
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Срок, часов</span>
          <input value={hoursStr} onChange={(e) => setHoursStr(e.target.value)} inputMode="numeric" className="input-blank mt-1.5 block w-24 rounded-sm px-3 py-2 text-[13px]" />
        </label>
        <button onClick={save} disabled={saving} className="btn btn-blue px-5 py-2.5 text-[13px]">
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
      <p className={`mt-3 text-[12.5px] ${total < 1 || total > MAX_TOTAL_OFFER_PERCENT ? "font-bold text-red" : "text-ink2"}`}>
        Итого после всех шагов: <strong className="text-ink">−{total}%</strong> (допустимо от 1 до {MAX_TOTAL_OFFER_PERCENT} %).
      </p>
    </div>
  );
}
