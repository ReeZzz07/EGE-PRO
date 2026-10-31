import { apiFetch } from "./supabase";

export interface TeacherClass {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
  members: number;
}

export interface TeacherMember {
  id: string;
  email: string;
  name: string;
  joinedAt: string;
  attempts: number;
  correct: number;
  reviewTopics: number;
  diagnostic: {
    subject: string;
    subjectName: string;
    level: string | null;
    scoreMin: number | null;
    scoreMax: number | null;
  } | null;
}

export interface StudentMembership {
  id: string;
  name: string;
  inviteCode: string;
  joinedAt: string;
  teacherName: string | null;
}

async function readJson(resp: Response) {
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? "Ошибка запроса");
  return json;
}

export async function loadTeacherClasses(): Promise<TeacherClass[]> {
  const resp = await apiFetch("/teacher/classes");
  const json = await readJson(resp);
  return json.classes ?? [];
}

export async function createTeacherClass(name: string): Promise<TeacherClass> {
  const resp = await apiFetch("/teacher/classes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const json = await readJson(resp);
  return json.class;
}

export async function deleteTeacherClass(id: string): Promise<void> {
  const resp = await apiFetch(`/teacher/classes/${encodeURIComponent(id)}`, { method: "DELETE" });
  await readJson(resp);
}

export async function loadClassMembers(classId: string): Promise<TeacherMember[]> {
  const resp = await apiFetch(`/teacher/classes/${encodeURIComponent(classId)}/members`);
  const json = await readJson(resp);
  return json.members ?? [];
}

export async function removeClassMember(classId: string, studentId: string): Promise<void> {
  const resp = await apiFetch(`/teacher/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(studentId)}`, { method: "DELETE" });
  await readJson(resp);
}

export async function joinClassByCode(code: string): Promise<{ classId: string; className: string }> {
  const resp = await apiFetch("/teacher/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  return readJson(resp);
}

export async function loadMyMemberships(): Promise<StudentMembership[]> {
  const resp = await apiFetch("/teacher/memberships");
  const json = await readJson(resp);
  return json.memberships ?? [];
}

export async function leaveClass(classId: string): Promise<void> {
  const resp = await apiFetch(`/teacher/memberships/${encodeURIComponent(classId)}`, { method: "DELETE" });
  await readJson(resp);
}
