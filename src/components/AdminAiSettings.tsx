import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { loadAiSettings, saveAiSettings, DEFAULT_AI_SETTINGS, type AiProvider, type AiSettings } from "../lib/aiSettings";
import { loadSystemPrompt, saveSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "../lib/aiPrompt";
import { Icon, useToast } from "./ui";

const PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", hint: "console.anthropic.com — ключ вида sk-ant-…" },
  { id: "qwen", label: "Qwen (Alibaba Cloud)", hint: "DashScope/QwenCloud — ключ вида sk-… или sk-ws-…" },
];

function SystemPromptCard() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  useEffect(() => {
    loadSystemPrompt().then((p) => {
      setPrompt(p);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveSystemPrompt(prompt, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — со следующего же запроса ИИ-репетитор работает по новому промпту", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Системный промпт</h2>
          <p className="mt-1 text-[12.5px] text-ink2">
            Персона, разрешённые и запрещённые действия, тон общения. Подставляется первым блоком в{" "}
            <strong className="text-ink">каждый</strong> запрос к модели — подсказки, объяснение темы, чат и проверку сочинений — поверх него
            уже собирается контекст конкретного задания и инструкция для текущего режима.
          </p>
        </div>
        <button onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT)} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          <Icon name="refresh" size={14} /> К дефолту
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={20}
        className="input-blank mt-4 w-full resize-y rounded-sm px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
      />
      <p className="mt-2 text-[11.5px] text-ink2">
        Осторожно с пунктом про запрет называть финальный ответ — это единственная строгая защита от прямой выдачи ответов; серверный
        постфильтр дополнительно перехватывает буквальные утечки в режиме подсказок, но не спасает от других режимов.
      </p>

      <button onClick={save} disabled={saving || !prompt.trim()} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px] disabled:opacity-50">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}

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
    <>
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

    <SystemPromptCard />
    </>
  );
}
