// Выбор LLM-провайдера для батч-решения: SOLVER_PROVIDER=anthropic (по умолчанию) | qwen.
import * as anthropic from "./anthropic.mjs";
import * as qwen from "./qwen.mjs";

const providers = { anthropic, qwen };

const name = (process.env.SOLVER_PROVIDER || "anthropic").toLowerCase();
const provider = providers[name];
if (!provider) {
  throw new Error(`Неизвестный SOLVER_PROVIDER=${name}. Доступны: ${Object.keys(providers).join(", ")}`);
}

export const { callWithTool, imageBlock, textBlock, usageSummary, MODEL, ENV_KEY_NAME, PROVIDER_NAME } = provider;
