// Посадочные страницы предметов /ege/<адрес>: адреса, склонения и общие вопросы-ответы берём из docker/api/content/subjects.json — тот же файл
// читает сервер, когда отдаёт страницу роботам (docker/api/botPages.js), так что у человека и у бота один и тот же смысл.
import subjectsJson from "../../docker/api/content/subjects.json";
import type { Subject } from "../data/tasks";
import { apiFetch } from "./supabase";

export interface SubjectPageMeta {
  slug: string;
  name: string;
  dative: string;
  desc: string;
}

export const SUBJECT_PAGES = subjectsJson as unknown as {
  /** предметы, у которых есть посадочная страница (остальные открываются как раньше) */
  landingSubjects: Subject[];
  subjects: Record<Subject, SubjectPageMeta>;
  sectionsTitle: string;
  faqTitle: string;
  uspTitle: string;
  usp: { t: string; d: string }[];
  faq: { q: string; a: string }[];
};

/** Предмет по адресу страницы; null — адреса нет в списке. */
export function subjectBySlug(slug: string): Subject | null {
  const id = SUBJECT_PAGES.landingSubjects.find((k) => SUBJECT_PAGES.subjects[k].slug === slug);
  return id ?? null;
}

export const hasSubjectPage = (subject: Subject): boolean => SUBJECT_PAGES.landingSubjects.includes(subject);

export const subjectPagePath = (subject: Subject): string => `/ege/${SUBJECT_PAGES.subjects[subject].slug}`;

export interface SubjectContent {
  total: number;
  sections: { name: string; n: number }[];
  topics: { name: string; n: number }[];
}

/** Разделы и темы предмета из банка заданий; null — сервер не ответил или заданий по предмету нет. */
export async function loadSubjectContent(subject: Subject): Promise<SubjectContent | null> {
  try {
    const resp = await apiFetch(`/public/subject/${SUBJECT_PAGES.subjects[subject].slug}`);
    return resp.ok ? ((await resp.json()) as SubjectContent) : null;
  } catch {
    return null;
  }
}
