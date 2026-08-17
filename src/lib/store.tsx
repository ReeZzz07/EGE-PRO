import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { TASKS, taskById, type Subject } from "../data/tasks";
import { dateKey } from "./utils";

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

type Action = { type: "ADD"; attempt: Attempt } | { type: "CLEAR_TASK"; taskId: string } | { type: "RESET" };

const KEY = "ege-pro.attempts.v1";

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(KEY);
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
    default:
      return state;
  }
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
  clearTask: (taskId: string) => void;
  resetAll: () => void;
}

const ProgressCtx = createContext<Ctx | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined as unknown as ProgressState, load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

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
    (["math", "rus", "inf", "fiz", "soc"] as Subject[]).forEach((s) => {
      const tasks = TASKS.filter((t) => t.subject === s);
      const atts = state.attempts.filter((a) => taskById(a.taskId)?.subject === s);
      perSubject[s] = {
        total: tasks.length,
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
  }, [state]);

  const value: Ctx = {
    state,
    derived,
    addAttempt: (attempt) => dispatch({ type: "ADD", attempt }),
    clearTask: (taskId) => dispatch({ type: "CLEAR_TASK", taskId }),
    resetAll: () => dispatch({ type: "RESET" }),
  };

  return <ProgressCtx.Provider value={value}>{children}</ProgressCtx.Provider>;
}

export function useProgress(): Ctx {
  const ctx = useContext(ProgressCtx);
  if (!ctx) throw new Error("useProgress outside provider");
  return ctx;
}
