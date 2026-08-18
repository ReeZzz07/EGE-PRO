// Supabase Edge Function: единая точка входа для ИИ-репетитора (раздел 9 ТЗ, упрощённый монолитный конвейер
// вместо отдельных микросервисов классификатора/RAG/ассессора — оправданный компромисс для MVP,
// см. .docs/TZ.md раздел 11.2 «не рекомендуется начинать с микросервисов»).
//
// Секреты, которые нужно задать перед деплоем (см. SETUP.md):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY доступны автоматически в рантайме Edge Functions.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { safeTaskById, type SafeTask } from "../_shared/tasks.ts";
import { TASK_ANSWERS } from "../_shared/answers.ts";
import { buildChatPrompt, buildEssaySystemPrompt, buildExplainPrompt, buildHintPrompt } from "./prompt.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Mode = "explain_topic" | "hint" | "check_essay" | "chat";

interface RequestBody {
  mode: Mode;
  message?: string;
  taskId?: string;
  hintLevel?: number;
  essayText?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

interface EssayCriterionResult {
  code: string;
  name: string;
  max: number;
  score: number;
  comment: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Постфильтр (раздел 9.1 ТЗ): грубая, но полезная страховка от утечки готового ответа в тексте подсказки. */
function leaksAnswer(text: string, taskId: string | undefined): boolean {
  if (!taskId) return false;
  const answers = TASK_ANSWERS[taskId];
  if (!answers) return false;
  const normalized = text.toLowerCase().replace(/ё/g, "е");
  return answers.some((a) => {
    const needle = a.toLowerCase().replace(/ё/g, "е");
    if (!needle) return false;
    const re = new RegExp(`(^|[^a-zа-я0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zа-я0-9]|$)`, "i");
    return re.test(normalized);
  });
}

async function callClaude(system: string, messages: { role: "user" | "assistant"; content: string }[], maxTokens = 700): Promise<string> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const block = (data.content ?? []).find((c: { type: string }) => c.type === "text");
  return (block?.text ?? "").trim();
}

async function callClaudeEssayAssessor(task: SafeTask, essayText: string): Promise<{ criteria: EssayCriterionResult[]; total: number; max: number; summary: string; improvementTips: string[] }> {
  const criteria = task.criteria ?? [];
  const criteriaText = criteria.map((c) => `${c.code} (макс. ${c.max} балл${c.max === 1 ? "" : "ов"}): ${c.name}`).join("\n");
  const userMsg = `Задание (тема: «${task.topic}»):\n${task.statement.join("\n")}\n\nКритерии оценивания:\n${criteriaText}\n\nОтвет ученика:\n"""\n${essayText || "(пусто)"}\n"""\n\nОцени ответ по каждому критерию и вызови submit_assessment.`;

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: buildEssaySystemPrompt(),
      messages: [{ role: "user", content: userMsg }],
      tools: [
        {
          name: "submit_assessment",
          description: "Отправить структурированную оценку развёрнутого ответа по критериям",
          input_schema: {
            type: "object",
            properties: {
              criteria: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    score: { type: "number" },
                    comment: { type: "string" },
                  },
                  required: ["code", "score", "comment"],
                },
              },
              summary: { type: "string" },
              improvementTips: { type: "array", items: { type: "string" } },
            },
            required: ["criteria", "summary", "improvementTips"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_assessment" },
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const toolUse = (data.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse) throw new Error("Модель не вернула структурированную оценку");

  const input = toolUse.input as { criteria: { code: string; score: number; comment: string }[]; summary: string; improvementTips: string[] };
  const clipped: EssayCriterionResult[] = input.criteria.map((c) => {
    const meta = criteria.find((k) => k.code === c.code);
    const max = meta?.max ?? Math.round(c.score);
    return { code: c.code, name: meta?.name ?? c.code, max, score: Math.max(0, Math.min(max, Math.round(c.score))), comment: c.comment };
  });
  const total = clipped.reduce((s, c) => s + c.score, 0);
  const max = clipped.reduce((s, c) => s + c.max, 0);
  return { criteria: clipped, total, max, summary: input.summary, improvementTips: input.improvementTips };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    if (!ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY не настроен на сервере — см. SETUP.md" }, 500);
    }

    // сервисная роль — только для служебного аудит-лога (ai_messages/hints_used), клиент туда писать не может (см. миграцию)
    const admin = serviceKey ? createClient(supabaseUrl, serviceKey) : null;

    const body = (await req.json()) as RequestBody;
    const task = body.taskId ? safeTaskById(body.taskId) : undefined;

    if (body.mode === "check_essay") {
      if (!task) return json({ error: "task not found" }, 404);
      const assessment = await callClaudeEssayAssessor(task, body.essayText ?? "");
      admin
        ?.from("ai_messages")
        .insert([
          { user_id: userId, task_id: body.taskId, mode: body.mode, role: "user", content: body.essayText ?? "" },
          { user_id: userId, task_id: body.taskId, mode: body.mode, role: "assistant", content: JSON.stringify(assessment) },
        ])
        .then(() => {}, (e: unknown) => console.warn("audit log failed", e));
      return json({ assessment });
    }

    const system =
      body.mode === "hint" ? buildHintPrompt(task, body.hintLevel ?? 0) : body.mode === "explain_topic" ? buildExplainPrompt(task) : buildChatPrompt(task);

    const history = (body.history ?? []).slice(-8);
    const messages = [...history, { role: "user" as const, content: body.message ?? "" }];

    let text = await callClaude(system, messages);

    if (body.mode === "hint" && leaksAnswer(text, body.taskId)) {
      console.warn("postfilter: подозрение на утечку ответа, подменяю ответ", { taskId: body.taskId, userId });
      text = "Кажется, я чуть не сказал больше, чем должен был 🙂 Давай по-другому: какой следующий шаг ты бы сделал сам, опираясь на предыдущую подсказку?";
    }

    if (body.mode === "hint") {
      admin?.from("hints_used").insert({ user_id: userId, task_id: body.taskId, level: (body.hintLevel ?? 0) + 1 }).then(() => {}, (e: unknown) => console.warn("hints log failed", e));
    }
    admin
      ?.from("ai_messages")
      .insert([
        { user_id: userId, task_id: body.taskId ?? null, mode: body.mode, role: "user", content: body.message ?? "" },
        { user_id: userId, task_id: body.taskId ?? null, mode: body.mode, role: "assistant", content: text },
      ])
      .then(() => {}, (e: unknown) => console.warn("audit log failed", e));

    return json({ text });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
