// Админ-доступ к массово импортированным заданиям (public.tasks/task_media) — проверка, правка,
// публикация того, что попало в базу с needs_review=true (см. scripts/import/publish-to-supabase.mjs).
import { supabase, isSupabaseConfigured, apiFetch } from "./supabase";
import { ALL_SUBJECTS } from "./dbTasks";
import type { EssayCriterion } from "../data/tasks";

export interface AdminMedia {
  id: number;
  storage_path: string;
  position: number;
}

export interface AdminTaskRow {
  id: string;
  subject: string;
  topic: string;
  bucket: "auto" | "essay";
  points: number;
  statement: string;
  answer: string | null;
  explanation: string | null;
  criteria: EssayCriterion[] | null;
  min_words: number | null;
  confidence: string | null;
  needs_review: boolean;
  published: boolean;
  created_at: string;
  task_media: AdminMedia[];
}

export interface SubjectStat {
  subject: string;
  total: number;
  published: number;
  needsReview: number;
}

export function mediaPublicUrl(storagePath: string): string {
  if (!supabase) return "";
  return supabase.storage.from("task-media").getPublicUrl(storagePath).data.publicUrl;
}

/** Список предметов, для которых вообще есть импортированные задания, со сводкой.
 *  Запрашиваем ПО ПРЕДМЕТУ, а не всю таблицу разом: у PostgREST жёсткий потолок
 *  PGRST_DB_MAX_ROWS=20000 на строки в ответе — с ~58 тыс. заданий общий запрос обрежется и даст
 *  неверные (заниженные/нулевые) цифры для части предметов; в рамках одного предмета строк
 *  заведомо меньше потолка. */
export async function loadTaskSubjectStats(): Promise<SubjectStat[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const results = await Promise.all(
    ALL_SUBJECTS.map(async (subject) => {
      const { data, error } = await supabase!.from("tasks").select("published").eq("subject", subject);
      if (error || !data || !data.length) return null;
      const rows = data as { published: boolean }[];
      const published = rows.filter((r) => r.published).length;
      return { subject, total: rows.length, published, needsReview: rows.length - published } as SubjectStat;
    })
  );
  return results.filter((s): s is SubjectStat => s !== null).sort((a, b) => a.subject.localeCompare(b.subject));
}

export async function loadTasks(opts: { subject?: string; onlyReview?: boolean; page: number; pageSize: number }): Promise<{ rows: AdminTaskRow[]; total: number }> {
  if (!isSupabaseConfigured || !supabase) return { rows: [], total: 0 };
  let q = supabase
    .from("tasks")
    .select("id, subject, topic, bucket, points, statement, answer, explanation, criteria, min_words, confidence, needs_review, published, created_at, task_media(id, storage_path, position)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });
  if (opts.subject) q = q.eq("subject", opts.subject);
  if (opts.onlyReview) q = q.eq("published", false);
  const from = opts.page * opts.pageSize;
  q = q.range(from, from + opts.pageSize - 1);
  const { data, error, count } = await q;
  if (error || !data) return { rows: [], total: 0 };
  return { rows: data as unknown as AdminTaskRow[], total: count ?? 0 };
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<AdminTaskRow, "topic" | "statement" | "answer" | "explanation" | "published" | "needs_review">>
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён" };
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  return error ? { error: error.message } : {};
}

export async function deleteTaskMedia(mediaId: number, storagePath: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён" };
  await supabase.storage.from("task-media").remove([storagePath]);
  const { error } = await supabase.from("task_media").delete().eq("id", mediaId);
  return error ? { error: error.message } : {};
}

export async function uploadTaskMedia(taskId: string, file: File): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Supabase не подключён" };
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const storagePath = `admin-uploads/${taskId}_${Date.now()}${ext}`;
  const { error: upErr } = await supabase.storage.from("task-media").upload(storagePath, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) return { error: upErr.message };
  const { error: insErr } = await supabase.from("task_media").insert({ task_id: taskId, storage_path: storagePath, position: 99 });
  return insErr ? { error: insErr.message } : {};
}

export interface ImportArchiveResult {
  tasksTotal: number;
  tasksOk: number;
  tasksFailed: number;
  published: number;
  needsReview: number;
  mediaOk: number;
  mediaFailed: number;
  errors: string[];
}

/** Ручной импорт из ZIP-архива (см. docker/api/importArchive.js) — предметы/задания с вложениями,
 *  минуя терминал/скрипты. Формат архива описан прямо в AdminTaskImport.tsx. */
export async function importArchive(file: File, subject: string): Promise<{ data?: ImportArchiveResult; error?: string }> {
  if (!isSupabaseConfigured) return { error: "Бэкенд не подключён" };
  const form = new FormData();
  form.append("subject", subject);
  form.append("archive", file, file.name);
  const resp = await apiFetch("/admin/import-archive", { method: "POST", body: form });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: json.error ?? resp.statusText };
  return { data: json as ImportArchiveResult };
}
