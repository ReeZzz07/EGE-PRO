// Настройки SMTP (сброс пароля, подтверждение email, чек об оплате) — public.app_settings,
// тот же паттерн, что у AdminAiSettings.tsx/AdminPaymentSettings.tsx.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { DEFAULT_SMTP_SETTINGS, loadSmtpSettings, saveSmtpSettings, type SmtpSettings } from "../lib/mailSettings";
import {
  DEFAULT_SITE_VERIFICATION,
  loadSiteVerification,
  saveSiteVerification,
  type SiteVerificationSettings,
} from "../lib/siteVerification";
import { Icon, useToast } from "./ui";

export default function AdminMailSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SmtpSettings>(DEFAULT_SMTP_SETTINGS);
  const [showPassword, setShowPassword] = useState(false);
  const [verification, setVerification] = useState<SiteVerificationSettings>(DEFAULT_SITE_VERIFICATION);
  const [savingVerification, setSavingVerification] = useState(false);

  useEffect(() => {
    Promise.all([loadSmtpSettings(), loadSiteVerification()]).then(([s, v]) => {
      setSettings(s);
      setVerification(v);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveSmtpSettings(settings, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новые письма сразу пойдут через этот сервер", "ok");
  };

  const saveVerification = async () => {
    if (!profile) return;
    setSavingVerification(true);
    const res = await saveSiteVerification(verification, profile.id);
    setSavingVerification(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — теги сразу подхватят поисковые роботы", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Почта: SMTP-сервер</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Подтверждение email при регистрации, сброс пароля, чек после оплаты. Для Яндекс 360 для бизнеса: host <code className="font-mono">smtp.yandex.ru</code>,
        порт <code className="font-mono">465</code> (SSL), логин — полный адрес почтового ящика, пароль — пароль приложения (не основной пароль от аккаунта,
        создаётся в настройках безопасности Яндекс ID).
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Host</span>
          <input
            value={settings.host}
            onChange={(e) => setSettings((s) => ({ ...s, host: e.target.value.trim() }))}
            placeholder="smtp.yandex.ru"
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Порт</span>
          <input
            type="number"
            value={settings.port}
            onChange={(e) => setSettings((s) => ({ ...s, port: Number(e.target.value) || 465 }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Логин (email ящика)</span>
          <input
            value={settings.user}
            onChange={(e) => setSettings((s) => ({ ...s, user: e.target.value.trim() }))}
            placeholder="noreply@ege-tutor.ru"
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Пароль приложения</span>
          <div className="mt-1.5 flex gap-2">
            <input
              type={showPassword ? "text" : "password"}
              value={settings.password}
              onChange={(e) => setSettings((s) => ({ ...s, password: e.target.value }))}
              className="input-blank flex-1 rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="btn btn-ghost px-3 py-2.5 text-[12px]">
              <Icon name="eye" size={14} />
            </button>
          </div>
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Имя отправителя</span>
          <input
            value={settings.fromName}
            onChange={(e) => setSettings((s) => ({ ...s, fromName: e.target.value }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Email отправителя <span className="font-normal normal-case">(пусто — тот же, что логин)</span>
          </span>
          <input
            value={settings.fromAddress}
            onChange={(e) => setSettings((s) => ({ ...s, fromAddress: e.target.value.trim() }))}
            placeholder={settings.user || "noreply@ege-tutor.ru"}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
          />
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>

    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Подтверждение прав на домен</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Мета-тег из Яндекс.Вебмастера, Google Search Console и т.п. — вставь сюда весь тег целиком (например{" "}
        <code className="font-mono">&lt;meta name="yandex-verification" content="..." /&gt;</code>), можно несколько строк для разных сервисов. Тег
        применяется сразу — без пересборки — но только для поисковых роботов и ботов соцсетей; обычным посетителям браузер отдаёт статическую страницу сайта,
        собранную заранее, поэтому это не подходит для тегов, которые проверяет не робот, а человек.
      </p>

      <label className="mt-4 block">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Мета-теги подтверждения</span>
        <textarea
          value={verification.metaTags}
          onChange={(e) => setVerification({ metaTags: e.target.value })}
          placeholder='<meta name="yandex-verification" content="..." />'
          rows={3}
          className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
        />
      </label>

      <button onClick={saveVerification} disabled={savingVerification} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {savingVerification ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
    </div>
  );
}
