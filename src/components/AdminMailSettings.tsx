// Настройки SMTP (сброс пароля, подтверждение email, чек об оплате) — public.app_settings,
// тот же паттерн, что у AdminAiSettings.tsx/AdminPaymentSettings.tsx.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { DEFAULT_SMTP_SETTINGS, loadSmtpSettings, saveSmtpSettings, type SmtpSettings } from "../lib/mailSettings";
import { isValidEmail } from "../lib/validation";
import { DEFAULT_MAIL_NOTICE, DEFAULT_MAIL_NOTICE_TEXT, MAIL_NOTICE_MAX, loadMailNoticeSettings, saveMailNoticeSettings, type MailNoticeSettings } from "../lib/mailNotice";
import { Icon, useToast } from "./ui";

export default function AdminMailSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SmtpSettings>(DEFAULT_SMTP_SETTINGS);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<MailNoticeSettings>(DEFAULT_MAIL_NOTICE);
  const [noticeSaving, setNoticeSaving] = useState(false);

  useEffect(() => {
    loadSmtpSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
    loadMailNoticeSettings().then(setNotice);
  }, []);

  const save = async () => {
    if (!profile) return;
    // Битый логин/адрес отправителя здесь ломает ВСЮ исходящую почту сайта разом (подтверждение
    // email, сброс пароля, чеки) — не только письма конкретному человеку, поэтому эта форма даже
    // важнее остальных для валидации.
    if (settings.user && !isValidEmail(settings.user)) return push("Проверь логин — это должен быть полный email-адрес ящика.", "err");
    if (settings.fromAddress && !isValidEmail(settings.fromAddress)) return push("Проверь email отправителя — похоже, в адресе опечатка.", "err");
    setSaving(true);
    const res = await saveSmtpSettings(settings, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новые письма сразу пойдут через этот сервер", "ok");
  };

  const saveNotice = async (next: MailNoticeSettings) => {
    if (!profile) return;
    setNoticeSaving(true);
    const res = await saveMailNoticeSettings(next, profile.id);
    setNoticeSaving(false);
    if (res.error) return push(res.error, "err");
    setNotice(next);
    push(next.enabled ? "Объявление включено — посетители увидят его через несколько секунд" : "Объявление выключено", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="space-y-5">
    <div className="sheet p-5 sm:p-6" data-testid="mail-notice-admin">
      <h2 className="font-display text-lg font-bold">Объявление «письма временно не приходят»</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Пока почта не работает, включи объявление: его увидят все на экранах регистрации, входа, восстановления пароля и «Подтверди почту». Когда почта
        заработает — выключи его здесь же.
      </p>
      <div className={`mt-3 flex items-center gap-3 border-2 p-3 ${notice.enabled ? "border-amber bg-amber/10" : "border-ink/15"}`}>
        <span className="text-[13px] font-bold">{notice.enabled ? "Сейчас показывается посетителям" : "Сейчас не показывается"}</span>
        <button
          onClick={() => saveNotice({ ...notice, enabled: !notice.enabled })}
          disabled={noticeSaving}
          className={`btn ${notice.enabled ? "btn-ghost" : "btn-blue"} ml-auto px-4 py-2 text-[12.5px]`}
        >
          {noticeSaving ? "Сохраняем…" : notice.enabled ? "Выключить" : "Включить"}
        </button>
      </div>
      <label className="mt-3 block">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
          Текст <span className="font-normal normal-case">(пусто — стандартный; {notice.text.length}/{MAIL_NOTICE_MAX})</span>
        </span>
        <textarea
          value={notice.text}
          onChange={(e) => setNotice((n) => ({ ...n, text: e.target.value.slice(0, MAIL_NOTICE_MAX) }))}
          rows={5}
          placeholder={DEFAULT_MAIL_NOTICE_TEXT}
          className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[13px] leading-relaxed"
        />
      </label>
      <button onClick={() => saveNotice(notice)} disabled={noticeSaving} className="btn btn-ghost mt-3 px-4 py-2 text-[12.5px]">
        <Icon name="check" size={14} /> Сохранить текст
      </button>
    </div>

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
            type="email"
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
            type="email"
            placeholder={settings.user || "noreply@ege-tutor.ru"}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
          />
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
    </div>
  );
}
