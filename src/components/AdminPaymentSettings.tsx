// Магазин ЮKassa (shopId + секретный ключ) для разовой оплаты тарифов — public.app_settings,
// тот же паттерн, что у AdminAiSettings.tsx (ключ ai_provider). Читает docker/api/yookassa.js на
// каждый платёж, так что сохранение здесь применяется сразу, без рестарта контейнеров.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { DEFAULT_YOOKASSA_SETTINGS, loadYookassaSettings, saveYookassaSettings, type YookassaSettings } from "../lib/paymentSettings";
import { SITE_URL } from "../lib/seo";
import { Icon, useToast } from "./ui";

export default function AdminPaymentSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<YookassaSettings>(DEFAULT_YOOKASSA_SETTINGS);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    loadYookassaSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveYookassaSettings(settings, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новые платежи сразу пойдут через этот магазин", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Оплата: магазин ЮKassa</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        shopId и секретный ключ из личного кабинета ЮKassa (Настройки → API). Пока не заполнено — платные тарифы на странице «Тарифы» показывают ошибку
        вместо кнопки оплаты.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <p className="mt-4 border-l-4 border-blue bg-blue/8 px-4 py-3 text-[13px] leading-relaxed text-ink2">
        <strong className="text-ink">URL для уведомлений (webhook)</strong> — добавь его в личном кабинете ЮKassa → Настройки → HTTP-уведомления, событие{" "}
        <code className="font-mono">payment.succeeded</code>:
        <br />
        <code className="mt-1 block break-all font-mono text-[12px]">{SITE_URL}/payments/yookassa/webhook</code>
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">shopId</span>
          <input
            value={settings.shopId}
            onChange={(e) => setSettings((s) => ({ ...s, shopId: e.target.value.trim() }))}
            placeholder="123456"
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
            autoComplete="off"
          />
        </label>

        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Секретный ключ</span>
          <div className="mt-1.5 flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={settings.secretKey}
              onChange={(e) => setSettings((s) => ({ ...s, secretKey: e.target.value.trim() }))}
              placeholder="live_… / test_…"
              className="input-blank flex-1 rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} className="btn btn-ghost px-3 py-2.5 text-[12px]">
              <Icon name="eye" size={14} />
            </button>
          </div>
          {settings.secretKey.startsWith("test_") && (
            <p className="mt-1.5 text-[11.5px] font-bold text-amber">Тестовый ключ — реальные деньги списываться не будут.</p>
          )}
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}
