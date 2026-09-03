// callAiTutor — единственная точка входа к ИИ-репетитору: настоящий backend, если подключён и
// отвечает, иначе честный офлайн-фолбэк (не молчание и не ошибка на экране). Тут же критично: при
// исчерпанном лимите/платном гейте backend отвечает 200 с limitReached/tierBlocked — это НЕ должно
// провоцировать offline-фолбэк (см. docker/api/server.js), иначе ученик вместо честного "лимит
// исчерпан" увидит шаблонную офлайн-подсказку, не понимая, что происходит на самом деле.
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

async function loadAiTutorOffline() {
  vi.doMock("./supabase", () => ({ isSupabaseConfigured: false, supabase: null, apiFetch: vi.fn() }));
  return import("./aiTutor");
}

async function loadAiTutorOnline(opts: { invoke: (name: string, o: unknown) => Promise<{ data: unknown; error: unknown }>; apiFetch?: (path: string) => Promise<Response> }) {
  vi.doMock("./supabase", () => ({
    isSupabaseConfigured: true,
    supabase: { functions: { invoke: opts.invoke } },
    apiFetch: opts.apiFetch ?? vi.fn(),
  }));
  return import("./aiTutor");
}

describe("callAiTutor — гостевой/офлайн режим (бэкенд не подключён)", () => {
  it("chat/hint/explain_topic — offline:true с непустым текстом от канонического движка подсказок", async () => {
    const { callAiTutor } = await loadAiTutorOffline();
    const res = await callAiTutor({ mode: "chat", message: "привет" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(true);
    expect(res.text).toBeTruthy();
  });

  it("check_essay без taskId/несуществующее задание — офлайн-заглушка «не нашёл задание», без assessment", async () => {
    const { callAiTutor } = await loadAiTutorOffline();
    const res = await callAiTutor({ mode: "check_essay", essayText: "текст" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(true);
    expect(res.assessment).toBeUndefined();
    expect(res.text).toMatch(/не нашёл задание/i);
  });
});

describe("loadAiQuota", () => {
  it("гостевой режим — не безлимитный тариф, а «нечего показывать», без сетевого вызова", async () => {
    const { loadAiQuota } = await loadAiTutorOffline();
    const quota = await loadAiQuota();
    expect(quota).toEqual({ limited: false });
  });

  it("бэкенд подключён, ответ ok — распарсенная квота как есть", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ limited: true, limit: 3, used: 1, remaining: 2 }) } as unknown as Response);
    const { loadAiQuota } = await loadAiTutorOnline({ invoke: vi.fn(), apiFetch });
    expect(await loadAiQuota()).toEqual({ limited: true, limit: 3, used: 1, remaining: 2 });
  });

  it("бэкенд ответил не-ok — {limited:false}, не бросает и не показывает мусор", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);
    const { loadAiQuota } = await loadAiTutorOnline({ invoke: vi.fn(), apiFetch });
    expect(await loadAiQuota()).toEqual({ limited: false });
  });

  it("сеть недоступна (fetch throws) — {limited:false}, не роняет UI", async () => {
    const apiFetch = vi.fn().mockRejectedValue(new Error("network down"));
    const { loadAiQuota } = await loadAiTutorOnline({ invoke: vi.fn(), apiFetch });
    expect(await loadAiQuota()).toEqual({ limited: false });
  });
});

describe("callAiTutor — бэкенд подключён", () => {
  it("успешный ответ функции — offline:false, поля data пробрасываются как есть", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { text: "Привет от настоящей модели" }, error: null });
    const { callAiTutor } = await loadAiTutorOnline({ invoke });
    const res = await callAiTutor({ mode: "chat", message: "hi" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res).toEqual({ offline: false, text: "Привет от настоящей модели" });
  });

  it("дневной лимит исчерпан (limitReached) — пробрасывается как есть, НЕ уходит в офлайн-фолбэк", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { text: "Лимит исчерпан", limitReached: true }, error: null });
    const { callAiTutor } = await loadAiTutorOnline({ invoke });
    const res = await callAiTutor({ mode: "chat", message: "hi" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(false);
    expect(res.limitReached).toBe(true);
    expect(res.text).toBe("Лимит исчерпан");
  });

  it("бесплатный тариф, проверка сочинений (tierBlocked) — пробрасывается как есть, НЕ уходит в офлайн-фолбэк", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { text: "Только на платных тарифах", tierBlocked: true }, error: null });
    const { callAiTutor } = await loadAiTutorOnline({ invoke });
    const res = await callAiTutor({ mode: "check_essay", taskId: "t1" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(false);
    expect(res.tierBlocked).toBe(true);
    expect(res.assessment).toBeUndefined();
  });

  it("функция вернула error — падает в офлайн-фолбэк, а не показывает ошибку/пустоту", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error("edge function down") });
    const { callAiTutor } = await loadAiTutorOnline({ invoke });
    const res = await callAiTutor({ mode: "chat", message: "hi" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(true);
    expect(res.text).toBeTruthy();
  });

  it("invoke бросает исключение (сеть недоступна) — тоже падает в офлайн-фолбэк", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("network down"));
    const { callAiTutor } = await loadAiTutorOnline({ invoke });
    const res = await callAiTutor({ mode: "chat", message: "hi" }, { mistakeTasks: [], solvedCount: 0 });
    expect(res.offline).toBe(true);
  });
});
