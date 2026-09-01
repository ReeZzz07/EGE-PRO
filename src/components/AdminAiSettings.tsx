import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { loadAiSettings, saveAiSettings, DEFAULT_AI_SETTINGS, type AiProvider, type AiSettings } from "../lib/aiSettings";
import { Icon, useToast } from "./ui";

const PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", hint: "console.anthropic.com — ключ вида sk-ant-…" },
  { id: "qwen", label: "Qwen (Alibaba Cloud)", hint: "DashScope/QwenCloud — ключ вида sk-… или sk-ws-…" },
];

export default function AdminAiSettings() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    loadAiSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveAiSettings(settings, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — новые запросы к ИИ-репетитору сразу пойдут через этот провайдер", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">ИИ-репетитор: провайдер и ключ</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Используется для подсказок, объяснения тем и проверки сочинений (эндпоинт <code>/ai-tutor</code>). Видно и редактируется только администратором.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSettings((s) => ({ ...s, provider: p.id }))}
            className={`rounded-sm border-2 p-3.5 text-left transition ${settings.provider === p.id ? "border-blue bg-blue/8" : "border-ink/15 hover:border-ink/35"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${settings.provider === p.id ? "border-blue bg-blue" : "border-ink/30"}`}>
                {settings.provider === p.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="text-[13.5px] font-bold">{p.label}</span>
            </div>
            <p className="mt-1 pl-6.5 text-[11.5px] text-ink2">{p.hint}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">API-ключ</span>
          <div className="key-row mt-1.5 flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
              placeholder={settings.provider === "qwen" ? "sk-… / sk-ws-…" : "sk-ant-…"}
              className="input-blank flex-1 rounded-sm px-3.5 py-2.5 font-mono text-[13px]"
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} className="btn btn-ghost px-3 py-2.5 text-[12px]">
              <Icon name="eye" size={14} />
            </button>
          </div>
        </label>

        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Модель <span className="font-normal text-ink2">(необязательно — по умолчанию {settings.provider === "qwen" ? "qwen-max" : "claude-sonnet-5"})</span>
          </span>
          <input
            value={settings.model}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            placeholder={settings.provider === "qwen" ? "qwen-max" : "claude-sonnet-5"}
            className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[13px]"
          />
        </label>

        {settings.provider === "qwen" && (
          <label className="block">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
              Base URL <span className="font-normal text-ink2">(необязательно — по умолчанию международный эндпоинт DashScope)</span>
            </span>
            <input
              value={settings.baseUrl}
              onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))}
              placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 font-mono text-[12.5px]"
            />
          </label>
        )}
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-5 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> Сохранить
      </button>
    </div>
  );
}
