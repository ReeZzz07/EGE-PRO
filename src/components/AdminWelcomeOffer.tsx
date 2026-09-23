// Настройка приветственной скидки на первую оплату (см. lib/offers.ts, docker/api/offers.js).
// Действует на всех платных тарифах для тех, кто ещё ни разу не платил, ограниченное время после
// подтверждения почты. Изменения применяются сразу — сервер читает настройки при каждой оплате.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { DEFAULT_WELCOME_OFFER_SETTINGS, loadWelcomeOfferSettings, saveWelcomeOfferSettings, type WelcomeOfferSettings } from "../lib/offers";
import { useToast } from "./ui";

export default function AdminWelcomeOffer() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WelcomeOfferSettings>(DEFAULT_WELCOME_OFFER_SETTINGS);
  // поля чисел храним строками, чтобы можно было стереть значение и набрать новое
  const [percentStr, setPercentStr] = useState(String(DEFAULT_WELCOME_OFFER_SETTINGS.percent));
  const [hoursStr, setHoursStr] = useState(String(DEFAULT_WELCOME_OFFER_SETTINGS.hours));

  useEffect(() => {
    loadWelcomeOfferSettings().then((s) => {
      setForm(s);
      setPercentStr(String(s.percent));
      setHoursStr(String(s.hours));
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveWelcomeOfferSettings({ enabled: form.enabled, percent: Number(percentStr), hours: Number(hoursStr) }, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — действует со следующей оплаты", "ok");
  };

  if (loading) return null;

  return (
    <div className="sheet mt-6 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Приветственная скидка на первую оплату</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
        Скидка на любой платный тариф для тех, кто ещё ни разу не платил. Отсчёт срока — от подтверждения почты. Показывается плашкой с таймером на главной, на
        странице тарифов и в блоках «это на платном тарифе», применяется сама при оплате. Не суммируется с персональной скидкой из карточки пользователя — берётся большая.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4" />
          Включена
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Скидка, %</span>
          <input value={percentStr} onChange={(e) => setPercentStr(e.target.value)} inputMode="numeric" className="input-blank mt-1.5 block w-24 rounded-sm px-3 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Срок, часов</span>
          <input value={hoursStr} onChange={(e) => setHoursStr(e.target.value)} inputMode="numeric" className="input-blank mt-1.5 block w-24 rounded-sm px-3 py-2 text-[13px]" />
        </label>
        <button onClick={save} disabled={saving} className="btn btn-blue px-5 py-2.5 text-[13px]">
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
