// Провайдер-независимые вызовы модели для ai-tutor — какого провайдера (Anthropic/Qwen) и с каким
// ключом использовать, решает настройка из public.app_settings (админка платформы), см. server.js.
// Портировано и объединено из solver-app/src/lib/providers/{anthropic,qwen}.js — та же логика вызова
// и та же защита от конфликта tool_choice + thinking-mode у Qwen3, найденная в этом проекте раньше.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const QWEN_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const QWEN_DEFAULT_MODEL = "qwen-max";
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Простой текстовый ответ (hint/explain_topic/chat) — без принудительного вызова инструмента. */
export async function callText(settings, system, messages, maxTokens = 700) {
  if (settings.provider === "qwen") return callQwenText(settings, system, messages, maxTokens);
  return callAnthropicText(settings, system, messages, maxTokens);
}

/** Структурированный ответ через принудительный вызов tool (check_essay). */
export async function callTool(settings, system, userContent, tool, maxTokens = 1500) {
  if (settings.provider === "qwen") return callQwenTool(settings, system, userContent, tool, maxTokens);
  return callAnthropicTool(settings, system, userContent, tool, maxTokens);
}

async function callAnthropicText(settings, system, messages, maxTokens) {
  const model = settings.model || ANTHROPIC_DEFAULT_MODEL;
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const block = (data.content ?? []).find((c) => c.type === "text");
  return (block?.text ?? "").trim();
}

async function callAnthropicTool(settings, system, userContent, tool, maxTokens) {
  const model = settings.model || ANTHROPIC_DEFAULT_MODEL;
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const toolUse = (data.content ?? []).find((c) => c.type === "tool_use");
  if (!toolUse) throw new Error("Модель не вернула структурированную оценку");
  return toolUse.input;
}

function toOpenAiTool(tool) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } };
}

async function callQwenText(settings, system, messages, maxTokens) {
  const baseUrl = (settings.baseUrl || QWEN_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = settings.model || QWEN_DEFAULT_MODEL;
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      enable_thinking: false,
    }),
  });
  if (!resp.ok) throw new Error(`Qwen API ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function callQwenTool(settings, system, userContent, tool, maxTokens) {
  const baseUrl = (settings.baseUrl || QWEN_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = settings.model || QWEN_DEFAULT_MODEL;
  const apiUrl = `${baseUrl}/chat/completions`;
  let lastErr;
  // Qwen3 (гибридные thinking-модели) иногда не подавляют thinking-режим через enable_thinking:false,
  // и тогда принудительный tool_choice конфликтует с ним (400 "does not support ... in thinking mode").
  // После первого такого случая переключаемся на tool_choice:"auto" + явную просьбу вызвать функцию.
  let forceAutoToolChoice = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const messages = [
        {
          role: "system",
          content: forceAutoToolChoice ? `${system}\n\nОБЯЗАТЕЛЬНО вызови функцию "${tool.name}" с результатом — не отвечай обычным текстом.` : system,
        },
        { role: "user", content: userContent },
      ];
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages,
          tools: [toOpenAiTool(tool)],
          tool_choice: forceAutoToolChoice ? "auto" : { type: "function", function: { name: tool.name } },
          enable_thinking: false,
        }),
      });
      if (resp.status === 429 || resp.status >= 500) {
        await sleep(Math.min(15000, 1000 * 2 ** attempt));
        continue;
      }
      if (!resp.ok) {
        const text = await resp.text();
        if (!forceAutoToolChoice && /thinking mode/i.test(text)) forceAutoToolChoice = true;
        throw new Error(`Qwen API ${resp.status}: ${text.slice(0, 500)}`);
      }
      const data = await resp.json();
      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) throw new Error("Модель не вызвала tool");
      return JSON.parse(call.function.arguments);
    } catch (e) {
      lastErr = e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("callQwenTool: исчерпаны попытки");
}
