// AuthProvider/useAuth — вся аутентификация платформы: гостевой режим (без бэкенда, чисто
// localStorage) и режим с подключённым Supabase-шимом. Особое внимание — updateProfile's сайд-
// эффект с primarySubject → addProfileSubject (см. profileSubjects.test.ts/tariffGate.test.js —
// это тот же лимит предметов по тарифу, только с клиентской стороны онбординга) и корректный
// маппинг колонок БД → Profile при загрузке сессии.
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

async function loadAuthGuest() {
  vi.doMock("./supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
  return import("./auth");
}

function makeConfiguredSupabaseMock(opts: { session?: { user: { id: string; email: string; user_metadata?: { full_name?: string } } } | null; profileRow?: Record<string, unknown> | null; subjectRows?: string[] } = {}) {
  const { session = null, profileRow = null, subjectRows = [] } = opts;
  let authChangeCb: ((event: string, session: unknown) => void) | null = null;
  const updateCalls: Record<string, unknown>[] = [];
  const insertCalls: Record<string, unknown>[] = [];
  let insertError: { message: string } | null = null;

  function profilesBuilder() {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: profileRow, error: null }),
      update: (patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return b;
      },
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    return b;
  }

  function profileSubjectsBuilder() {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => Promise.resolve({ data: subjectRows.map((s) => ({ subject: s })), error: null }),
      insert: (row: Record<string, unknown>) => {
        insertCalls.push(row);
        return Promise.resolve({ error: insertError });
      },
    };
    return b;
  }

  const from = vi.fn((table: string) => (table === "profiles" ? profilesBuilder() : profileSubjectsBuilder()));
  const signUp = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });

  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        authChangeCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signUp,
      signInWithPassword,
      signOut,
    },
    from,
  };

  return {
    supabase,
    triggerAuthChange: (event: string, s: unknown) => act(() => authChangeCb?.(event, s)),
    updateCalls,
    insertCalls,
    setInsertError: (msg: string | null) => {
      insertError = msg ? { message: msg } : null;
    },
    signUp,
    signInWithPassword,
    signOut,
  };
}

async function loadAuthConfigured(opts?: Parameters<typeof makeConfiguredSupabaseMock>[0]) {
  const mock = makeConfiguredSupabaseMock(opts);
  vi.doMock("./supabase", () => ({ isSupabaseConfigured: true, supabase: mock.supabase }));
  const mod = await import("./auth");
  return { ...mod, mock };
}

describe("AuthProvider — гостевой режим (isSupabaseConfigured=false)", () => {
  it("ничего не сохранено — profile=null, loading=false, isGuestMode=true", async () => {
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.isGuestMode).toBe(true);
  });

  it("восстанавливает ранее сохранённый гостевой профиль из localStorage при старте", async () => {
    localStorage.setItem("ege-pro.guest-profile.v1", JSON.stringify({ id: "guest-1", name: "Т", email: "t@t.local", subjects: ["math"] }));
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.email).toBe("t@t.local");
    expect(result.current.profile?.subjects).toEqual(["math"]);
  });

  it("signUp: создаёт профиль с пустыми subjects и сохраняет в localStorage", async () => {
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp("a@b.com", "pw", "Аня");
    });

    expect(result.current.profile).toMatchObject({ name: "Аня", email: "a@b.com", subjects: [] });
    const saved = JSON.parse(localStorage.getItem("ege-pro.guest-profile.v1")!);
    expect(saved.email).toBe("a@b.com");
  });

  it("signIn: email совпадает с сохранённым гостевым профилем — успех", async () => {
    localStorage.setItem("ege-pro.guest-profile.v1", JSON.stringify({ id: "guest-1", name: "Т", email: "t@t.local", subjects: [] }));
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { error?: string } = {};
    await act(async () => {
      res = await result.current.signIn("t@t.local", "любой-пароль");
    });
    expect(res.error).toBeUndefined();
    expect(result.current.profile?.email).toBe("t@t.local");
  });

  it("signIn: несовпадающий email — понятная ошибка про отсутствие проверки пароля в гостевом режиме", async () => {
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { error?: string } = {};
    await act(async () => {
      res = await result.current.signIn("nobody@x.com", "pw");
    });
    expect(res.error).toMatch(/гостевом режиме/i);
  });

  it("signOut: очищает и профиль в памяти, и localStorage", async () => {
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signUp("a@b.com", "pw", "Аня");
    });
    expect(result.current.profile).not.toBeNull();

    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.profile).toBeNull();
    expect(localStorage.getItem("ege-pro.guest-profile.v1")).toBeNull();
  });

  it("updateProfile: мёрджит патч в текущий профиль и персистит в localStorage", async () => {
    const { AuthProvider, useAuth } = await loadAuthGuest();
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signUp("a@b.com", "pw", "Аня");
    });

    await act(async () => {
      await result.current.updateProfile({ grade: "11", dailyMinutes: 30 });
    });

    expect(result.current.profile).toMatchObject({ name: "Аня", grade: "11", dailyMinutes: 30 });
    const saved = JSON.parse(localStorage.getItem("ege-pro.guest-profile.v1")!);
    expect(saved.grade).toBe("11");
  });
});

describe("AuthProvider — режим с бэкендом (isSupabaseConfigured=true)", () => {
  it("нет активной сессии — loading становится false, profile=null, isGuestMode=false", async () => {
    const { AuthProvider, useAuth } = await loadAuthConfigured({ session: null });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.isGuestMode).toBe(false);
  });

  it("есть сессия и строка в profiles — профиль собирается из всех полей БД, с subjects и дефолтным tariffId=free", async () => {
    const { AuthProvider, useAuth } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: {
        id: "u1",
        full_name: "Иван",
        grade: "11",
        exam_year: 2027,
        goal: "80plus",
        daily_minutes: 45,
        primary_subject: "math",
        onboarded_at: "2026-01-01T00:00:00.000Z",
        is_admin: false,
        tariff_id: null,
      },
      subjectRows: ["math", "rus"],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toMatchObject({
      id: "u1",
      name: "Иван",
      email: "u1@x.com",
      grade: "11",
      examYear: 2027,
      goal: "80plus",
      dailyMinutes: 45,
      primarySubject: "math",
      subjects: ["math", "rus"],
      isAdmin: false,
      tariffId: "free", // null в БД → дефолт "free", не null
    });
    expect(result.current.profile?.onboardedAt).toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
  });

  it("есть сессия, но строки в profiles ещё нет (триггер не успел/гонка) — минимальный fallback-профиль", async () => {
    const { AuthProvider, useAuth } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com", user_metadata: { full_name: "Резервное имя" } } },
      profileRow: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toEqual({ id: "u1", name: "Резервное имя", email: "u1@x.com", subjects: [] });
  });

  it("onAuthStateChange: новая сессия — подгружает профиль; null-сессия (выход) — очищает профиль", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({ session: null });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toBeNull();

    mock.supabase.from.mockImplementation((table: string) =>
      table === "profiles"
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "u2", full_name: "Вика" }, error: null }) }) }) }
        : { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
    );
    await mock.triggerAuthChange("SIGNED_IN", { user: { id: "u2", email: "u2@x.com" } });
    await waitFor(() => expect(result.current.profile?.id).toBe("u2"));

    await mock.triggerAuthChange("SIGNED_OUT", null);
    await waitFor(() => expect(result.current.profile).toBeNull());
  });

  it("signUp: ошибка от Supabase пробрасывается, profile не трогается", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({ session: null });
    mock.signUp.mockResolvedValue({ data: { user: null }, error: { message: "уже зарегистрирован" } });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { error?: string } = {};
    await act(async () => {
      res = await result.current.signUp("a@b.com", "pw", "Аня");
    });
    expect(res.error).toBe("уже зарегистрирован");
    expect(result.current.profile).toBeNull();
  });

  it("signUp: успех — оптимистично выставляет профиль с пустыми subjects до подтверждения от БД", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({ session: null });
    mock.signUp.mockResolvedValue({ data: { user: { id: "new-1" } }, error: null });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp("a@b.com", "pw", "Аня");
    });
    expect(result.current.profile).toEqual({ id: "new-1", name: "Аня", email: "a@b.com", subjects: [] });
  });

  it("signIn: ошибка от Supabase пробрасывается как есть", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({ session: null });
    mock.signInWithPassword.mockResolvedValue({ error: { message: "неверный пароль" } });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let res: { error?: string } = {};
    await act(async () => {
      res = await result.current.signIn("a@b.com", "wrong");
    });
    expect(res.error).toBe("неверный пароль");
  });

  it("signOut: вызывает supabase.auth.signOut() и очищает профиль", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван" },
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    await act(async () => {
      await result.current.signOut();
    });
    expect(mock.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.profile).toBeNull();
  });

  it("updateProfile: пишет в profiles с правильным маппингом camelCase → snake_case", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван", primary_subject: "rus" },
      subjectRows: ["rus"],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    await act(async () => {
      await result.current.updateProfile({ name: "Иван Иванов", grade: "11", examYear: 2027, dailyMinutes: 20, tariffId: "attestat" });
    });

    expect(mock.updateCalls[mock.updateCalls.length - 1]).toMatchObject({
      full_name: "Иван Иванов",
      grade: "11",
      exam_year: 2027,
      daily_minutes: 20,
      tariff_id: "attestat",
    });
  });

  it("updateProfile: новый primarySubject (которого ещё нет в subjects) — добавляет через addProfileSubject и обновляет локальный список", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван" },
      subjectRows: [], // ещё ни одного предмета
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    await act(async () => {
      await result.current.updateProfile({ primarySubject: "fiz" });
    });

    expect(mock.insertCalls).toEqual([{ user_id: "u1", subject: "fiz" }]);
    expect(result.current.profile?.subjects).toEqual(["fiz"]);
  });

  it("updateProfile: primarySubject уже входит в subjects — НЕ вызывает addProfileSubject повторно", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван", primary_subject: "math" },
      subjectRows: ["math"],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile?.subjects).toEqual(["math"]));

    await act(async () => {
      await result.current.updateProfile({ primarySubject: "math", dailyMinutes: 15 });
    });

    expect(mock.insertCalls).toEqual([]);
  });

  it("updateProfile: лимит предметов по тарифу исчерпан (ошибка от триггера БД) — subjects локально не меняются", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван" },
      subjectRows: ["math", "rus"],
    });
    mock.setInsertError("Достигнут лимит предметов по текущему тарифу");
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile?.subjects).toEqual(["math", "rus"]));

    await act(async () => {
      await result.current.updateProfile({ primarySubject: "fiz" });
    });

    expect(result.current.profile?.subjects).toEqual(["math", "rus"]); // "fiz" не добавился
  });

  it("refreshSubjects: перечитывает subjects из БД и обновляет профиль", async () => {
    const { AuthProvider, useAuth, mock } = await loadAuthConfigured({
      session: { user: { id: "u1", email: "u1@x.com" } },
      profileRow: { id: "u1", full_name: "Иван" },
      subjectRows: ["math"],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.profile?.subjects).toEqual(["math"]));

    mock.supabase.from.mockImplementation((table: string) =>
      table === "profile_subjects"
        ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ subject: "math" }, { subject: "fiz" }], error: null }) }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "u1" }, error: null }) }) }) }
    );
    await act(async () => {
      await result.current.refreshSubjects();
    });
    expect(result.current.profile?.subjects).toEqual(["math", "fiz"]);
  });
});

describe("useAuth", () => {
  it("вызов вне AuthProvider бросает исключение", async () => {
    const { useAuth } = await loadAuthGuest();
    expect(() => renderHook(() => useAuth())).toThrow(/outside provider/i);
  });
});

// primarySubject хранится отдельной колонкой в profiles и в норме всегда входит в subjects (см.
// updateProfile), но на практике встречались аккаунты, где это разошлось — предмет по умолчанию
// указывал на то, чего нет среди подключённых (см. Dashboard.tsx/App.tsx/SessionSummary.tsx).
describe("effectivePrimarySubject", () => {
  it("primarySubject есть среди subjects — берём его", async () => {
    const { effectivePrimarySubject } = await loadAuthGuest();
    expect(effectivePrimarySubject({ primarySubject: "rus", subjects: ["rus", "math_base"] })).toBe("rus");
  });

  it("primarySubject не входит в subjects (десинхронизация) — берём первый подключённый", async () => {
    const { effectivePrimarySubject } = await loadAuthGuest();
    expect(effectivePrimarySubject({ primarySubject: "bio", subjects: ["rus", "math_base"] })).toBe("rus");
  });

  it("primarySubject не задан — берём первый подключённый", async () => {
    const { effectivePrimarySubject } = await loadAuthGuest();
    expect(effectivePrimarySubject({ subjects: ["fiz"] })).toBe("fiz");
  });

  it("подключённых предметов нет — undefined", async () => {
    const { effectivePrimarySubject } = await loadAuthGuest();
    expect(effectivePrimarySubject({ subjects: [] })).toBeUndefined();
  });

  it("профиль не загружен — undefined", async () => {
    const { effectivePrimarySubject } = await loadAuthGuest();
    expect(effectivePrimarySubject(null)).toBeUndefined();
  });
});
