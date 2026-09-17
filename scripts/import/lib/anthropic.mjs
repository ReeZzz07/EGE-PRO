// Тонкая обёртка над Anthropic Messages API для батч-решения заданий.
// Без SDK — только fetch, чтобы не тащить лишнюю зависимость в скрипт.

const API_URL = "https://api.anthropic.com/v1/messages";
export const MODEL = process.env.SOLVER_MODEL || "claude-sonnet-5";
export const ENV_KEY_NAME = "ANTHROPIC_API_KEY";
export const PROVIDER_NAME = "anthropic";

let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

export function usageSummary() {
  return { totalCalls, totalInputTokens, totalOutputTokens };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.system
 * @param {Array} opts.content — content-блоки user-сообщения (текст + изображения)
 * @param {object} opts.tool — форсированный tool (name, description, input_schema)
 * @param {number} [opts.maxTokens]
 * @returns {Promise<object>} — input объекта tool_use
 */
// Найдено при разборе живых жалоб на обрывы в разборах заданий ("По графику Тогда Значит," —
// шаг без единого вычисленного значения): модель упиралась в max_tokens ПОСЕРЕДИНЕ строкового
// поля tool_use (обычно reasoning/explanation — самое длинное поле), а stop_reason при этом никто
// не проверял — усечённый, но валидный как JSON текст просто уходил в БД как есть. Раз наткнулись
// на лимит — увеличиваем бюджет и пробуем заново, а не отдаём обрубленный текст молча.
export async function callWithTool({ apiKey, system, content, tool, maxTokens = 1500 }) {
  let lastErr;
  let budget = maxTokens;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: budget,
          system,
          messages: [{ role: "user", content }],
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
        }),
      });

      if (resp.status === 429 || resp.status >= 500) {
        const wait = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
        await sleep(wait);
        continue;
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 500)}`);
      }
      const data = await resp.json();
      totalCalls++;
      totalInputTokens += data.usage?.input_tokens ?? 0;
      totalOutputTokens += data.usage?.output_tokens ?? 0;
      if (data.stop_reason === "max_tokens") {
        // не возвращаем усечённый ответ как есть — удваиваем бюджет и пробуем ещё раз (до
        // потолка), иначе в БД попадёт JSON с недописанным полем ровно там, где не хватило токенов.
        budget = Math.min(budget * 2, 8000);
        throw new Error(`max_tokens (${maxTokens}) — ответ обрезан, увеличиваю бюджет до ${budget} и пробую снова`);
      }
      const toolUse = (data.content ?? []).find((c) => c.type === "tool_use");
      if (!toolUse) throw new Error("Модель не вызвала tool");
      return toolUse.input;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("callWithTool: исчерпаны попытки");
}

export function imageBlock(base64, mediaType) {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}

export function textBlock(text) {
  return { type: "text", text };
}
