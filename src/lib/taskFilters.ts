// Общая логика фильтрации банка заданий — используется и в TaskBank (список с фильтрами), и в
// SolveView (переключение на предыдущее/следующее задание "в пределах того фильтра, по которому
// отобраны задания"), чтобы оба места считали один и тот же список одинаково.
import { TASKS, type EgeTask, type Subject } from "../data/tasks";

export type TaskStatus = "all" | "new" | "solved" | "mistake";

export interface TaskBankFilters {
  subject: Subject | "all";
  diff: 0 | 1 | 2 | 3;
  status: TaskStatus;
  query: string;
}

export const DEFAULT_FILTERS: TaskBankFilters = { subject: "all", diff: 0, status: "all", query: "" };

export function filterTasks(filters: TaskBankFilters, derived: { solvedIds: Set<string>; mistakeIds: Set<string> }): EgeTask[] {
  const q = filters.query.trim().toLowerCase();
  return TASKS.filter((t) => {
    if (filters.subject !== "all" && t.subject !== filters.subject) return false;
    if (filters.diff && t.difficulty !== filters.diff) return false;
    if (filters.status === "new" && (derived.solvedIds.has(t.id) || derived.mistakeIds.has(t.id))) return false;
    if (filters.status === "solved" && !derived.solvedIds.has(t.id)) return false;
    if (filters.status === "mistake" && !derived.mistakeIds.has(t.id)) return false;
    if (q && !(`${t.topic} ${t.statement.join(" ")} ${t.fipiId}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

const STORAGE_KEY = "ege-pro.taskBankFilters.v1";

/** Последние применённые фильтры банка заданий — переживают возврат на страницу (ссылка «Банк
 *  заданий» из решения задания) и перезагрузку страницы. */
export function loadTaskBankFilters(): TaskBankFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_FILTERS;
}

export function saveTaskBankFilters(filters: TaskBankFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}
