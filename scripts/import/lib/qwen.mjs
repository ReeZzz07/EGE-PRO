// Обёртка над Qwen (Alibaba Cloud DashScope) через OpenAI-совместимый эндпоинт —
// тот же интерфейс, что и lib/anthropic.mjs (callWithTool/imageBlock/textBlock/usageSummary/MODEL),
// чтобы solve-tasks.mjs мог переключаться между провайдерами без изменений в логике конвейера.
//
// Заметка по надёжности: форсированный tool_choice у vision-моделей (qwen-vl-max) поддерживается
// не так стабильно, как у текстовых (qwen-max) — обязательно проверь калибровочным прогоном
// (--limit=3), прежде чем гнать весь корпус.

const BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const API_URL = `${BASE_URL}/chat/completions`;

// текстовая модель дешевле — используем её для заданий без картинок, vision — только когда нужна
const TEXT_MODEL = process.env.SOLVER_MODEL_TEXT || "qwen-max";
const VISION_MODEL = process.env.SOLVER_MODEL_VISION || "qwen-vl-max";
export const MODEL = `${TEXT_MODEL} / ${VISION_MODEL}`;
export const ENV_KEY_NAME = "DASHSCOPE_API_KEY";
export const PROVIDER_NAME = "qwen";

let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let totalCalls = 0;

export function usageSummary() {
  return { totalCalls, totalInputTokens: totalPromptTokens, totalOutputTokens: totalCompletionTokens };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** JSON Schema (Anthropic input_schema) -> OpenAI function-calling parameters — формат идентичен, просто переупаковка. */
function toOpenAiTool(tool) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}

function hasImage(content) {
  return content.some((c) => c.type === "image_url");
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.system
 * @param {Array} opts.content — content-блоки user-сообщения (текст + изображения, в формате lib/qwen.mjs)
 * @param {object} opts.tool — форсированный tool (name, description, input_schema) — тот же формат, что для Anthropic
 * @param {number} [opts.maxTokens]
 * @returns {Promise<object>} — распарсенные аргументы вызова функции
 */
export async function callWithTool({ apiKey, system, content, tool, maxTokens = 1500 }) {
  const model = hasImage(content) ? VISION_MODEL : TEXT_MODEL;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          tools: [toOpenAiTool(tool)],
          tool_choice: { type: "function", function: { name: tool.name } },
        }),
      });

      if (resp.status === 429 || resp.status >= 500) {
        const wait = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
        await sleep(wait);
        continue;
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Qwen (DashScope) API ${resp.status}: ${text.slice(0, 500)}`);
      }
      const data = await resp.json();
      totalCalls++;
      totalPromptTokens += data.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += data.usage?.completion_tokens ?? 0;

      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) throw new Error("Модель не вызвала tool (проверь, поддерживает ли выбранная модель tool_choice)");
      return JSON.parse(call.function.arguments);
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("callWithTool: исчерпаны попытки");
}

export function imageBlock(base64, mediaType) {
  return { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } };
}

export function textBlock(text) {
  return { type: "text", text };
}
