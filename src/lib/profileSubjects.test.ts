// Тесты перевода ошибок БД в понятные сообщения на русском (см. также серверные тесты тарифов —
// docker/api/test/tariffGate.test.js — этот файл покрывает клиентскую сторону того же лимита
// предметов: триггер enforce_subject_limit шлёт техническое сообщение, addProfileSubject должен
// превратить его в то, что реально покажется ученику в тосте на дашборде).
import { describe, expect, it, vi } from "vitest";
import { addProfileSubject, loadProfileSubjects, removeProfileSubject } from "./profileSubjects";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}));

/** Мини-имитация билдера запросов PostgREST — все методы чейнятся сами на себя, `then`
 *  резолвит сконфигурированный результат, независимо от того, на каком шаге цепочки awaited. */
function mockQueryResult(result: { data?: unknown; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    insert: () => builder,
    delete: () => builder,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

describe("addProfileSubject", () => {
  it("успех — пустой объект без error", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ error: null }) as never);
    const res = await addProfileSubject("u1", "math");
    expect(res).toEqual({});
  });

  it("лимит предметов по тарифу — понятное сообщение с предложением тарифа", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ error: { message: "Достигнут лимит предметов по текущему тарифу" } }) as never);
    const res = await addProfileSubject("u1", "fiz");
    expect(res.error).toMatch(/тарифе больше предметов не добавить/);
  });

  it("дублирующийся предмет (unique violation) — «уже добавлен», а не сырой текст ошибки", async () => {
    vi.mocked(supabase!.from).mockReturnValue(
      mockQueryResult({ error: { message: 'duplicate key value violates unique constraint "profile_subjects_user_id_subject_key"' } }) as never
    );
    const res = await addProfileSubject("u1", "math");
    expect(res.error).toBe("Этот предмет уже добавлен.");
  });

  it("прочая ошибка БД — сообщение передаётся как есть (не проглатывается)", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ error: { message: "connection refused" } }) as never);
    const res = await addProfileSubject("u1", "math");
    expect(res.error).toBe("connection refused");
  });
});

describe("loadProfileSubjects", () => {
  it("маппит строки {subject} в список Subject", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ data: [{ subject: "math" }, { subject: "rus" }], error: null }) as never);
    const subjects = await loadProfileSubjects("u1");
    expect(subjects).toEqual(["math", "rus"]);
  });

  it("ошибка запроса — пустой список, а не throw (вызывающий код на это полагается)", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ error: { message: "boom" } }) as never);
    const subjects = await loadProfileSubjects("u1");
    expect(subjects).toEqual([]);
  });
});

describe("removeProfileSubject", () => {
  it("успех — пустой объект без error", async () => {
    vi.mocked(supabase!.from).mockReturnValue(mockQueryResult({ error: null }) as never);
    const res = await removeProfileSubject("u1", "math");
    expect(res).toEqual({});
  });
});
