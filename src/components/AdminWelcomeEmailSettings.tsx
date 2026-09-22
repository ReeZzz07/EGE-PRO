// Текст приветственного письма с советами — уходит один раз, автоматически, сразу после того как
// ученик подтвердит email (см. docker/api/server.js → POST /auth/verify-email, docker/api/mailer.js
// → sendWelcomeEmail). Оформление (шапка со звездой, рамки, кнопка) зашито в mailer.js и одинаково
// для всех — здесь редактируется только сам текст.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  loadWelcomeEmailSettings,
  saveWelcomeEmailSettings,
  sendTestWelcomeEmail,
  DEFAULT_WELCOME_EMAIL_SETTINGS,
  type WelcomeEmailSettings,
} from "../lib/welcomeEmailSettings";
import { Icon, useToast } from "./ui";

export default function AdminWelcomeEmailSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState<WelcomeEmailSettings>(DEFAULT_WELCOME_EMAIL_SETTINGS);

  useEffect(() => {
    loadWelcomeEmailSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveWelcomeEmailSettings(settings, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новые регистрации сразу получат этот текст", "ok");
  };

  const sendTest = async () => {
    if (!settings.subject.trim() || !settings.bodyText.trim()) return push("Заполни тему и текст письма", "err");
    setTesting(true);
    const res = await sendTestWelcomeEmail(settings);
    setTesting(false);
    if (res.error) push(res.error, "err");
    else push(`Тестовое письмо ушло на ${profile?.email}`, "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Приветственное письмо</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Уходит один раз, автоматически — сразу после того как ученик подтвердит email. Оформление (шапка, рамки, кнопка) в стиле платформы уже зашито и
        везде одинаковое, здесь редактируется только текст.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тема письма</span>
          <input
            value={settings.subject}
            onChange={(e) => setSettings((s) => ({ ...s, subject: e.target.value }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Текст письма <span className="font-normal normal-case">(пустая строка — разделитель между абзацами, форматирование — обычным текстом)</span>
          </span>
          <textarea
            value={settings.bodyText}
            onChange={(e) => setSettings((s) => ({ ...s, bodyText: e.target.value }))}
            rows={14}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn btn-blue px-5 py-2.5 text-[13px]">
          <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        <button onClick={sendTest} disabled={testing || !isSupabaseConfigured} className="btn btn-ghost px-5 py-2.5 text-[13px]">
          <Icon name="send" size={14} /> {testing ? "Отправляем…" : `Отправить тестовое на ${profile?.email ?? "мою почту"}`}
        </button>
      </div>
    </div>
  );
}
