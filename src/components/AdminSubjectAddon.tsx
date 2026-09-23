// Докупка предметов к платному тарифу (см. lib/subscription.ts, docker/api/subscription.js): цена
// одного предмета за 30 дней и выключатель. Докупка считается пропорционально оставшемуся сроку
// тарифа, докупленные предметы входят в продление «как было».
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { DEFAULT_ADDON_SETTINGS, loadAddonSettings, saveAddonSettings } from "../lib/subscription";
import { useToast } from "./ui";

export default function AdminSubjectAddon() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULT_ADDON_SETTINGS.enabled);
  const [priceStr, setPriceStr] = useState(String(DEFAULT_ADDON_SETTINGS.priceRub));

  useEffect(() => {
    loadAddonSettings().then((s) => {
      setEnabled(s.enabled);
      setPriceStr(String(s.priceRub));
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveAddonSettings({ enabled, priceRub: Number(priceStr) }, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — действует сразу", "ok");
  };

  if (loading) return null;

  return (
    <div className="sheet mt-6 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Докупка предметов</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
        Ученик с действующим платным тарифом может докупить предметы сверх тарифа. Цена ниже — за один предмет на 30 дней; при докупке считается пропорционально оставшемуся
        сроку (тариф и докупка кончаются в один день), при продлении докупленные предметы включаются в сумму. Если выключить — докупка пропадает из интерфейса, а
        уже докупленные предметы в продление не входят.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-[13px] font-bold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Включена
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Цена за предмет, ₽/мес</span>
          <input value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="numeric" className="input-blank mt-1.5 block w-32 rounded-sm px-3 py-2 text-[13px]" />
        </label>
        <button onClick={save} disabled={saving} className="btn btn-blue px-5 py-2.5 text-[13px]">
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
