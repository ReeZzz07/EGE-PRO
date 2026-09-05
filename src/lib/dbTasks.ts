// Банк заданий целиком живёт в БД (public.tasks, ~58 тыс. строк после импорта — см.
// scripts/import/publish-neofamily.mjs). Полная выгрузка всего банка одним запросом на старте
// когда-то была здесь (см. git-историю) — с реальным объёмом это ~130 МБ JSON и упирается в
// PGRST_DB_MAX_ROWS=20000 (часть заданий просто не приезжала). Вместо этого — ленивая подгрузка
// по предмету: полные тексты заданий грузятся, когда пользователь реально открывает предмет
// (TaskBank/SolveView), а лёгкие агрегаты (сколько всего заданий/баллов по предмету) — отдельным
// дешёвым запросом сразу при старте, чтобы Dashboard/TaskBank сразу показывали верные цифры.
import { useSyncExternalStore } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";
import { TASKS, SUBJECTS, type EgeTask, type Subject, type EssayCriterion } from "../data/tasks";

interface DbTaskRow {
  id: string;
  subject: string;
  topic: string;
  section: string | null;
  ege_number: number | null;
  bucket: "auto" | "essay";
  points: number;
  statement: string;
  options: string[] | null;
  answer: string | null;
  explanation: string | null;
  hints: string[];
  criteria: EssayCriterion[] | null;
  min_words: number | null;
  confidence: string | null;
  task_media: { storage_path: string; position: number }[];
}

function confidenceToDifficulty(confidence: string | null): 1 | 2 | 3 {
  if (confidence === "high") return 1;
  if (confidence === "low") return 3;
  return 2;
}

function toEgeTask(row: DbTaskRow): EgeTask {
  const images = (row.task_media ?? [])
    .sort((a, b) => a.position - b.position)
    .map((m) => supabase!.storage.from("task-media").getPublicUrl(m.storage_path).data.publicUrl);

  // маркеры "[ИЗОБРАЖЕНИЕ N]" — служебная разметка из импорта (см. scripts/import/lib/clean-html.mjs),
  // отмечавшая место картинки в исходном HTML. Сама картинка уже рендерится отдельным блоком ниже
  // (task_media/images), поэтому в тексте условия маркер — просто мусор, убираем.
  const statement = row.statement
    .replace(/\[ИЗОБРАЖЕНИЕ\s*\d*\]/gi, " ")
    .split(/\n+/)
    .map((s) => s.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean);
  const hints3: [string, string, string] = [row.hints[0] ?? "Подумай, какая тема ЕГЭ здесь задействована.", row.hints[1] ?? row.hints[0] ?? "", row.hints[2] ?? row.hints[1] ?? row.hints[0] ?? ""];

  if (row.bucket === "essay") {
    return {
      id: row.id,
      fipiId: row.id,
      subject: row.subject as Subject,
      egeNumber: row.ege_number ?? 0,
      topic: row.topic,
      section: row.section ?? undefined,
      difficulty: confidenceToDifficulty(row.confidence),
      points: row.points,
      statement,
      images: images.length ? images : undefined,
      answers: [],
      answerNote: "развёрнутый ответ — проверяется по критериям, единого «правильного» текста нет",
      explanation: ["Готового текста ответа система не выдаёт для этого типа заданий — есть только критерии оценивания."],
      hints: hints3,
      answerType: "essay",
      criteria: row.criteria ?? [],
      minWords: row.min_words ?? undefined,
    };
  }

  return {
    id: row.id,
    fipiId: row.id,
    subject: row.subject as Subject,
    egeNumber: row.ege_number ?? 0,
    topic: row.topic,
    section: row.section ?? undefined,
    difficulty: confidenceToDifficulty(row.confidence),
    points: row.points,
    statement,
    images: images.length ? images : undefined,
    answers: row.answer ? [row.answer] : [],
    answerNote: "см. формат ответа в условии задания",
    explanation: (row.explanation ?? "").split(/\n+/).filter(Boolean),
    hints: hints3,
  };
}

const SELECT_COLS =
  "id, subject, topic, section, ege_number, bucket, points, statement, options, answer, explanation, hints, criteria, min_words, confidence, task_media(storage_path, position)";

// ─────────────────────── реактивность (React external store) ───────────────────────
// TASKS — обычный мутируемый модульный массив (так исторически устроен весь остальной код:
// TaskBank/Dashboard/SolveView читают его напрямую). Раньше он наполнялся один раз ДО первого
// рендера, поэтому реактивность была не нужна. Теперь пополняется асинхронно в фоне — компонентам
// нужен способ узнать «данные обновились, перерисуйся». useTasksVersion() даёт именно это.
let version = 0;
const listeners = new Set<() => void>();
function bump() {
  version++;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getVersion() {
  return version;
}
/** Заставляет компонент перерисоваться, когда фоновая подгрузка добавляет новые задания в TASKS. */
export function useTasksVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// ─────────────────────── агрегаты по предметам (лёгкие, для счётчиков) ───────────────────────
interface SubjectAgg {
  count: number;
  points: number;
  essay: number;
}
const subjectAggs: Partial<Record<Subject, SubjectAgg>> = {};
let subjectAggsLoaded = false;

/** Сколько всего опубликованных заданий по предмету есть в БД (даже если сам предмет ещё не
 *  подгружен полностью) — с фолбэком на то, что уже реально загружено в TASKS. */
export function getSubjectTotal(subject: Subject): number {
  const loaded = TASKS.reduce((n, t) => (t.subject === subject ? n + 1 : n), 0);
  return Math.max(subjectAggs[subject]?.count ?? 0, loaded);
}

/** Сумма первичных баллов по предмету — для «X из Y п.б.» на карточках. */
export function getSubjectPointsTotal(subject: Subject): number {
  const loaded = TASKS.reduce((n, t) => (t.subject === subject ? n + t.points : n), 0);
  return Math.max(subjectAggs[subject]?.points ?? 0, loaded);
}

/** Дешёвый фоновый запрос при старте — только колонка points по опубликованным заданиям,
 *  ОТДЕЛЬНО по каждому предмету (не общим запросом: у PostgREST жёсткий потолок
 *  PGRST_DB_MAX_ROWS=20000 на строки в ответе — общий запрос на ~58 тыс. строк обрежется и даст
 *  неверные цифры для «поздних» предметов; по одному предмету строк заведомо меньше потолка).
 *  Даёт верные счётчики сразу, не дожидаясь открытия предмета в TaskBank. */
export async function loadSubjectAggregates(): Promise<void> {
  if (subjectAggsLoaded || !isSupabaseConfigured || !supabase) return;
  subjectAggsLoaded = true;
  await Promise.all(
    ALL_SUBJECTS.map(async (s) => {
      try {
        const { data, error } = await supabase!.from("tasks").select("points, bucket").eq("published", true).eq("subject", s);
        if (error || !data) return;
        const rows = data as { points: number; bucket: string }[];
        subjectAggs[s] = {
          count: rows.length,
          points: rows.reduce((sum, r) => sum + r.points, 0),
          essay: rows.filter((r) => r.bucket === "essay").length,
        };
      } catch (e) {
        console.warn(`Не удалось загрузить агрегат предмета ${s}:`, e);
      }
    })
  );
  bump();
}

/** Сумма первичных баллов по всему банку — для лендинга. Для "личного зачёта" (Главная/Статистика/
 *  Профиль) это НЕ то число — там нужна сумма только по подключённым предметам ученика, иначе
 *  знаменатель обещает баллы за предметы, которых на его тарифе физически нет, см.
 *  getSubjectsPointsTotal ниже. */
export function getGlobalPointsTotal(): number {
  return ALL_SUBJECTS.reduce((sum, s) => sum + getSubjectPointsTotal(s), 0);
}

/** То же самое, но только по переданным предметам — для личного прогресса, а не витрины всего банка. */
export function getSubjectsPointsTotal(subjects: Subject[]): number {
  return subjects.reduce((sum, s) => sum + getSubjectPointsTotal(s), 0);
}

/** Сколько всего заданий с развёрнутым ответом (эссе/сочинение) в опубликованном банке. */
export function getEssayTaskTotal(): number {
  return ALL_SUBJECTS.reduce((sum, s) => sum + (subjectAggs[s]?.essay ?? 0), 0);
}

// ─────────────────────── ленивая подгрузка полных заданий ───────────────────────
const hydratedSubjects = new Set<Subject>();
const loadingSubjects = new Set<Subject>();

export function isSubjectHydrated(subject: Subject): boolean {
  return hydratedSubjects.has(subject);
}
export function isSubjectLoading(subject: Subject): boolean {
  return loadingSubjects.has(subject);
}

/** Догружает ВСЕ опубликованные задания одного предмета в TASKS. Идемпотентно — повторный
 *  вызов для уже загруженного/загружаемого предмета ничего не делает. */
export async function hydrateSubjectTasks(subject: Subject): Promise<void> {
  if (hydratedSubjects.has(subject) || loadingSubjects.has(subject) || !isSupabaseConfigured || !supabase) return;
  loadingSubjects.add(subject);
  bump();
  try {
    const { data, error } = await supabase.from("tasks").select(SELECT_COLS).eq("published", true).eq("subject", subject).range(0, 19999);
    if (error) {
      console.warn(`Не удалось загрузить задания предмета ${subject}:`, error.message);
      return;
    }
    const existingIds = new Set(TASKS.map((t) => t.id));
    for (const row of (data ?? []) as unknown as DbTaskRow[]) {
      if (existingIds.has(row.id)) continue;
      TASKS.push(toEgeTask(row));
    }
  } catch (e) {
    console.warn(`Ошибка загрузки заданий предмета ${subject}:`, e);
  } finally {
    hydratedSubjects.add(subject);
    loadingSubjects.delete(subject);
    bump();
  }
}

/** Заявки hydrateTasksByIds, которые уже в полёте — Statistics/тетрадь ошибок/store.tsx все зовут
 *  эту функцию своим отдельным эффектом при первом рендере, нередко с пересекающимися id. Раньше
 *  "уже загружено?" проверялось один раз ДО await, тем же снимком existingIds после ответа сервера
 *  и вставлялось в TASKS — если параллельный вызов успевал вставить тот же id, пока этот ждал сеть,
 *  проверка по устаревшему снимку её не видела, и задание задваивалось в TASKS (см. также
 *  hydrateSubjectTasks ниже — там existingIds уже и так пересчитывается после await, отсюда и
 *  асимметрия, которую здесь чиним). */
const pendingTaskIds = new Set<string>();

/** Точечная подгрузка конкретных заданий по id — нужна, когда пользователь возвращается к уже
 *  решённому/ошибочному заданию (тетрадь ошибок, статистика), а его предмет ещё не был открыт
 *  в этой сессии (после перезагрузки страницы TASKS снова пуст). */
export async function hydrateTasksByIds(ids: string[]): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const existingIds = new Set(TASKS.map((t) => t.id));
  const missing = [...new Set(ids)].filter((id) => !existingIds.has(id) && !pendingTaskIds.has(id));
  if (!missing.length) return;
  missing.forEach((id) => pendingTaskIds.add(id));
  try {
    const { data, error } = await supabase.from("tasks").select(SELECT_COLS).in("id", missing);
    if (error || !data) return;
    // пересчитываем на момент вставки, а не по снимку до запроса — see комментарий у pendingTaskIds
    const freshIds = new Set(TASKS.map((t) => t.id));
    for (const row of data as unknown as DbTaskRow[]) {
      if (freshIds.has(row.id)) continue;
      TASKS.push(toEgeTask(row));
      freshIds.add(row.id);
    }
    bump();
  } catch (e) {
    console.warn("Не удалось догрузить задания по id:", e);
  } finally {
    missing.forEach((id) => pendingTaskIds.delete(id));
  }
}

/** Сумма getSubjectTotal по всем предметам — сколько всего заданий в банке (для «все N заданий»
 *  в интерфейсе), без необходимости грузить все предметы целиком. */
export function getGlobalTaskTotal(): number {
  return ALL_SUBJECTS.reduce((sum, s) => sum + getSubjectTotal(s), 0);
}

/** То же самое, но только по переданным предметам — см. комментарий у getSubjectsPointsTotal. */
export function getSubjectsTaskTotal(subjects: Subject[]): number {
  return subjects.reduce((sum, s) => sum + getSubjectTotal(s), 0);
}

/** Все коды предметов — удобно для перебора (Object.keys(SUBJECTS) даёт то же самое, экспортируем
 *  здесь просто чтобы не тащить SUBJECTS туда, где нужны только id). */
export const ALL_SUBJECTS = Object.keys(SUBJECTS) as Subject[];

/** Предметы, которые реально можно выбрать/показать: с заданиями в банке (getSubjectTotal > 0).
 *  Пока агрегаты не подгрузились (subjectAggsLoaded === false) или бэкенд не подключён — отдаём
 *  все предметы как есть, чтобы не мигать пустым списком на первом рендере; список сужается сам
 *  собой, как только придут реальные цифры (см. bump() в loadSubjectAggregates). Так предмет без
 *  исходников (сейчас — «Информатика») просто не показывается для выбора нигде в интерфейсе, а
 *  появится сам собой, как только для него импортируют задания — код трогать не придётся. */
export function getAvailableSubjects(): Subject[] {
  if (!isSupabaseConfigured || !subjectAggsLoaded) return ALL_SUBJECTS;
  return ALL_SUBJECTS.filter((s) => getSubjectTotal(s) > 0);
}
