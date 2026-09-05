// Шкала перевода первичных баллов в тестовые (public.score_scales, см.
// supabase/migrations/0017_score_scales.sql) — меняется каждый год решением комиссии
// Рособрнадзора, поэтому не зашита в код: одна строка = один первичный балл конкретного предмета
// в конкретном году → вторичный (тестовый) балл. Правится через AdminScoreScales.tsx.
//
// Базовая математика — не про 100-балльную шкалу: вузы её не принимают, итог — школьная оценка
// 2-5. Строки в таблице те же (primary_score → secondary_score), просто число здесь означает
// оценку, а не тестовый балл — переключатель подписи см. isGradeSubject ниже.
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Subject } from "../data/tasks";

export interface ScorePoint {
  primary: number;
  secondary: number;
}

/** Базовая математика переводится в оценку (2-5), а не в тестовый балл — единственное место,
 *  где это нужно знать: как подписать число на экране (см. ProfileView.tsx/MockExam.tsx). */
export function isGradeSubject(subject: Subject): boolean {
  return subject === "math_base";
}

export async function loadScoreScale(subject: Subject, year: number): Promise<ScorePoint[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("score_scales")
    .select("primary_score, secondary_score")
    .eq("subject", subject)
    .eq("year", year)
    .order("primary_score");
  if (error || !data) return [];
  return (data as { primary_score: number; secondary_score: number }[]).map((r) => ({ primary: r.primary_score, secondary: r.secondary_score }));
}

/** Все годы, для которых по предмету есть хоть одна строка — свежий сверху, для выбора "последней
 *  известной" шкалы (см. loadLatestScoreScale) и для выпадающего списка в админке. */
export async function listScoreScaleYears(subject: Subject): Promise<number[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.from("score_scales").select("year").eq("subject", subject);
  if (error || !data) return [];
  return [...new Set((data as { year: number }[]).map((r) => r.year))].sort((a, b) => b - a);
}

/** То, что реально нужно ученику на экранах результатов — самая свежая известная шкала по
 *  предмету, без необходимости знать заранее, какой год ей соответствует. */
export async function loadLatestScoreScale(subject: Subject): Promise<{ year: number; scale: ScorePoint[] } | null> {
  const years = await listScoreScaleYears(subject);
  if (!years.length) return null;
  const year = years[0];
  const scale = await loadScoreScale(subject, year);
  return scale.length ? { year, scale } : null;
}

/** Заменяет всю шкалу для (subject, year) целиком — сначала удаляет прежние строки, потом
 *  вставляет новые. Не мёрджит частично: см. AdminScoreScales.tsx — там ввод разом через один
 *  textarea (весь список пар), а не построчным редактированием одной ячейки за раз. */
export async function saveScoreScale(subject: Subject, year: number, rows: ScorePoint[]): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const del = await supabase.from("score_scales").delete().eq("subject", subject).eq("year", year);
  if (del.error) return { error: del.error.message };
  if (!rows.length) return {};
  const payload = rows.map((r) => ({ subject, year, primary_score: r.primary, secondary_score: r.secondary }));
  const { error } = await supabase.from("score_scales").insert(payload);
  return error ? { error: error.message } : {};
}

export async function deleteScoreScale(subject: Subject, year: number): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Бэкенд не подключён." };
  const { error } = await supabase.from("score_scales").delete().eq("subject", subject).eq("year", year);
  return error ? { error: error.message } : {};
}

/** Ищет вторичный балл по точному первичному баллу — с фолбэком на ближайший меньший на случай,
 *  если в конкретной шкале вдруг пропущены отдельные значения. */
export function lookupSecondary(scale: ScorePoint[], primary: number): number | null {
  if (!scale.length) return null;
  const exact = scale.find((p) => p.primary === primary);
  if (exact) return exact.secondary;
  const below = [...scale].filter((p) => p.primary <= primary).sort((a, b) => b.primary - a.primary)[0];
  return below ? below.secondary : scale[0].secondary;
}

/** Мини-пробник (см. MockExam.tsx) даёт всего несколько заданий, а не полный вариант — сырой балл
 *  оттуда напрямую в шкалу не подставить, она рассчитана на диапазон 0..maxPrimary РЕАЛЬНОГО
 *  экзамена. Вместо этого берём долю правильного (0..1), проецируем на позицию в реальном
 *  диапазоне и смотрим вторичный балл уже там — так соблюдается нелинейность реальной шкалы,
 *  а не выдумывается линейная формула поверх выдуманного диапазона (как было раньше). */
export function convertByFraction(scale: ScorePoint[], fraction: number): number | null {
  if (!scale.length) return null;
  const maxPrimary = scale[scale.length - 1].primary;
  const scaledPrimary = Math.round(Math.max(0, Math.min(1, fraction)) * maxPrimary);
  return lookupSecondary(scale, scaledPrimary);
}
