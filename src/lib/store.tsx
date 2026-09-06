import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { TASKS, taskById, type Subject } from "../data/tasks";
import { dateKey } from "./utils";
import { supabase, isSupabaseConfigured } from "./supabase";
import { useAuth } from "./auth";
import { ALL_SUBJECTS, getSubjectTotal, hydrateTasksByIds, useTasksVersion } from "./dbTasks";
import { recordTopicOutcome } from "./spacedReview";

export interface Attempt {
  taskId: string;
  given: string;
  correct: boolean;
  ts: number;
  seconds: number; // время решения
}

interface ProgressState {
  attempts: Attempt[];
}

type Action = { type: "ADD"; attempt: Attempt } | { type: "CLEAR_TASK"; taskId: string } | { type: "RESET" } | { type: "LOAD"; attempts: Attempt[] };

/** Только для гостевого режима (Supabase не настроен) — там на весь браузер один профиль
 *  (см. GUEST_KEY в lib/auth.tsx), так что один общий ключ безопасен. */
const GUEST_KEY = "ege-pro.attempts.v1";
/** Попытки реального аккаунта — свой ключ на пользователя. Раньше все попытки лежали под
 *  одним общим GUEST_KEY независимо от того, кто вошёл — на одном браузере (в т.ч. при QA
 *  тестовыми аккаунтами) попытки предыдущего/чужого пользователя утекали в текущего: сразу
 *  видны в счётчике ошибок, а при первом входе ещё и мигрировались в Supabase под чужим user_id
 *  (см. syncOnLogin). */
const userAttemptsKey = (userId: string) => `ege-pro.attempts.${userId}.v1`;

function load(key: string): ProgressState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as ProgressState;
  } catch {
    /* ignore */
  }
  return { attempts: [] };
}

function reducer(state: ProgressState, action: Action): ProgressState {
  switch (action.type) {
    case "ADD":
      return { attempts: [...state.attempts, action.attempt] };
    case "CLEAR_TASK":
      return { attempts: state.attempts.filter((a) => a.taskId !== action.taskId) };
    case "RESET":
      return { attempts: [] };
    case "LOAD":
      return { attempts: action.attempts };
    default:
      return state;
  }
}

/** Загружает попытки пользователя из Supabase, переносит туда локальные (гостевые) при первом
 *  входе — и на каждый вызов МЁРДЖИТ локальные и удалённые попытки объединением, а не заменой.
 *  Раньше эта функция вызывалась на КАЖДОЙ перезагрузке страницы (не только при первом входе — ref
 *  syncedUserId сбрасывается на каждый маунт) и подменяла state.attempts удалённой копией целиком.
 *  Запись попытки в Supabase (см. addAttempt ниже) асинхронная и не блокирует UI — если сразу после
 *  решения задания перезагрузить страницу, запрос insert мог не успеть завершиться, и такая замена
 *  теряла самую свежую попытку целиком (а вместе с ней и стрик, который считается по датам попыток). */
async function syncOnLogin(userId: string, local: Attempt[]): Promise<Attempt[]> {
  if (!supabase) return local;
  const migratedFlag = `ege-pro.migrated.${userId}`;
  const { data: remoteRows } = await supabase.from("attempts").select("task_id, given, correct, seconds, created_at").eq("user_id", userId);
  const remote: Attempt[] = (remoteRows ?? []).map((r) => ({ taskId: r.task_id, given: r.given, correct: r.correct, seconds: r.seconds, ts: new Date(r.created_at).getTime() }));

  let alreadyMigrated = false;
  try {
    alreadyMigrated = localStorage.getItem(migratedFlag) === "1";
  } catch {
    /* ignore */
  }

  if (!alreadyMigrated && local.length > 0) {
    const rows = local.map((a) => ({ user_id: userId, task_id: a.taskId, given: a.given, correct: a.correct, seconds: a.seconds, created_at: new Date(a.ts).toISOString() }));
    await supabase.from("attempts").insert(rows);
  }
  if (!alreadyMigrated) {
    try {
      localStorage.setItem(migratedFlag, "1");
    } catch {
      /* ignore */
    }
  }

  const seen = new Set(local.map((a) => `${a.taskId}|${a.ts}`));
  const merged = [...local];
  for (const r of remote) {
    const key = `${r.taskId}|${r.ts}`;
    if (!seen.has(key)) {
      merged.push(r);
      seen.add(key);
    }
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

export interface Derived {
  attempts: Attempt[];
  solvedIds: Set<string>;
  mistakeIds: Set<string>;
  earnedPoints: number;
  accuracy: number; // 0..1
  streak: number;
  totalTimeSec: number;
  perSubject: Record<Subject, { total: number; solved: number; attempts: number; correct: number; points: number }>;
  recent: Attempt[];
}

interface Ctx {
  state: ProgressState;
  derived: Derived;
  addAttempt: (a: Attempt) => void;
  /** локально убирает попытки по задаче сразу; на бэкенде (не гостевой режим) — тоже, без этого
   *  задание при следующей синхронизации с сервером возвращалось бы в тетрадь как ни в чём не бывало. */
  clearTask: (taskId: string) => Promise<void>;
  /** то же самое для полного сброса — см. комментарий у clearTask выше. */
  resetAll: () => Promise<void>;
}

const ProgressCtx = createContext<Ctx | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined as unknown as ProgressState, () =>
    isSupabaseConfigured ? { attempts: [] } : load(GUEST_KEY)
  );
  const { profile, isGuestMode } = useAuth();
  const syncedUserId = useRef<string | null>(null);

  useEffect(() => {
    try {
      if (isGuestMode) localStorage.setItem(GUEST_KEY, JSON.stringify(state));
      else if (profile) localStorage.setItem(userAttemptsKey(profile.id), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, isGuestMode, profile?.id]);

  // очки/статистика по предметам считаются через taskById() (см. derived ниже) — а после
  // перезагрузки страницы TASKS снова пуст (банк грузится лениво по предмету, см. lib/dbTasks.ts).
  // Без этого earnedPoints/perSubject показывали 0 или заниженные числа для всех задач, кроме
  // той, что открыта прямо сейчас. Подгружаем ВСЕ когда-либо затронутые задания централизованно
  // здесь, а не на каждой отдельной странице — тогда любой потребитель derived получает верные числа.
  useEffect(() => {
    const ids = [...new Set(state.attempts.map((a) => a.taskId))];
    if (ids.length) hydrateTasksByIds(ids);
  }, [state.attempts]);

  // при входе в настоящий (не гостевой) аккаунт — подгружаем и мигрируем попытки в Supabase.
  // Локальный кэш читаем строго из ключа ЭТОГО userId (не из текущего state — тот в момент
  // смены пользователя ещё может содержать попытки предыдущего вошедшего на этом браузере).
  useEffect(() => {
    if (isGuestMode) return;
    const nextId = profile?.id ?? null;
    if (syncedUserId.current === nextId) return;
    syncedUserId.current = nextId;
    if (!nextId) {
      dispatch({ type: "LOAD", attempts: [] });
      return;
    }
    const local = load(userAttemptsKey(nextId)).attempts;
    syncOnLogin(nextId, local).then((merged) => dispatch({ type: "LOAD", attempts: merged }));
  }, [profile?.id, isGuestMode]);

  const tasksVersion = useTasksVersion();

  const derived = useMemo<Derived>(() => {
    const solved = new Set<string>();
    for (const a of state.attempts) if (a.correct) solved.add(a.taskId);
    const withWrong = new Set(state.attempts.filter((a) => !a.correct).map((a) => a.taskId));
    const mistakes = new Set([...withWrong].filter((id) => !solved.has(id)));
    const earnedPoints = [...solved].reduce((s, id) => s + (taskById(id)?.points ?? 0), 0);
    const correctCount = state.attempts.filter((a) => a.correct).length;
    const accuracy = state.attempts.length ? correctCount / state.attempts.length : 0;

    // серия дней с верными решениями (сегодня/вчера)
    const days = new Set(state.attempts.filter((a) => a.correct).map((a) => dateKey(a.ts)));
    let streak = 0;
    const cursor = new Date();
    if (!days.has(dateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dateKey(cursor.getTime()))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    const perSubject = {} as Derived["perSubject"];
    ALL_SUBJECTS.forEach((s) => {
      const tasks = TASKS.filter((t) => t.subject === s);
      const atts = state.attempts.filter((a) => taskById(a.taskId)?.subject === s);
      perSubject[s] = {
        total: getSubjectTotal(s),
        solved: tasks.filter((t) => solved.has(t.id)).length,
        attempts: atts.length,
        correct: atts.filter((a) => a.correct).length,
        points: tasks.filter((t) => solved.has(t.id)).reduce((sum, t) => sum + t.points, 0),
      };
    });

    return {
      attempts: state.attempts,
      solvedIds: solved,
      mistakeIds: mistakes,
      earnedPoints,
      accuracy,
      streak,
      totalTimeSec: state.attempts.reduce((s, a) => s + a.seconds, 0),
      perSubject,
      recent: [...state.attempts].sort((x, y) => y.ts - x.ts).slice(0, 8),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tasksVersion]);

  const addAttempt = (attempt: Attempt) => {
    dispatch({ type: "ADD", attempt });
    // интервальное повторение (раздел 3.4 ТЗ) — ошибка планирует повтор темы через растущие
    // интервалы, верный ответ (когда срок подошёл) двигает его дальше; см. lib/spacedReview.ts.
    // Работает и в гостевом режиме — там profile.id тоже стабилен между перезагрузками.
    const task = taskById(attempt.taskId);
    if (profile && task) recordTopicOutcome(profile.id, task.subject, task.topic, attempt.correct);
    if (!isGuestMode && profile && supabase) {
      supabase
        .from("attempts")
        .insert({ user_id: profile.id, task_id: attempt.taskId, given: attempt.given, correct: attempt.correct, seconds: attempt.seconds, created_at: new Date(attempt.ts).toISOString() })
        .then(({ error }) => {
          if (error) console.warn("Не удалось сохранить попытку в Supabase:", error.message);
        });
    }
  };

  const clearTask = async (taskId: string) => {
    dispatch({ type: "CLEAR_TASK", taskId });
    if (!isGuestMode && supabase && profile) {
      const { error } = await supabase.from("attempts").delete().eq("user_id", profile.id).eq("task_id", taskId);
      if (error) console.warn("Не удалось убрать попытки из Supabase:", error.message);
    }
  };

  const resetAll = async () => {
    dispatch({ type: "RESET" });
    if (!isGuestMode && supabase && profile) {
      const { error } = await supabase.from("attempts").delete().eq("user_id", profile.id);
      if (error) console.warn("Не удалось стереть попытки в Supabase:", error.message);
    }
  };

  const value: Ctx = {
    state,
    derived,
    addAttempt,
    clearTask,
    resetAll,
  };

  return <ProgressCtx.Provider value={value}>{children}</ProgressCtx.Provider>;
}

export function useProgress(): Ctx {
  const ctx = useContext(ProgressCtx);
  if (!ctx) throw new Error("useProgress outside provider");
  return ctx;
}
