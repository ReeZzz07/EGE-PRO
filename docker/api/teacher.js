// Учительский MVP: классы, код приглашения, список учеников и краткий прогресс.
// Флаг profiles.is_teacher (или is_admin) — иначе 403. API: /teacher/*
import crypto from "node:crypto";
import { pool } from "./db.js";
import { SUBJECT_NAMES } from "./subjectNames.js";

export class TeacherError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function assertTeacher(userId) {
  const { rows } = await pool.query("select is_admin, is_teacher from public.profiles where id = $1", [userId]);
  const p = rows[0];
  if (!p || (!p.is_admin && !p.is_teacher)) throw new TeacherError(403, "Нужны права учителя");
  return p;
}

function inviteCode() {
  // без I/O/0/1 — чтобы не путать при диктовке
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function listClasses(teacherId) {
  await assertTeacher(teacherId);
  const { rows } = await pool.query(
    `select c.id, c.name, c.invite_code, c.created_at,
            (select count(*)::int from public.teacher_class_members m where m.class_id = c.id) as members
       from public.teacher_classes c
      where c.teacher_id = $1
      order by c.created_at desc`,
    [teacherId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    createdAt: r.created_at,
    members: r.members,
  }));
}

export async function createClass(teacherId, name) {
  await assertTeacher(teacherId);
  const trimmed = String(name ?? "").trim().slice(0, 80);
  if (trimmed.length < 1) throw new TeacherError(400, "Укажите название класса");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode();
    try {
      const { rows } = await pool.query(
        `insert into public.teacher_classes (teacher_id, name, invite_code)
         values ($1, $2, $3) returning id, name, invite_code, created_at`,
        [teacherId, trimmed, code]
      );
      const r = rows[0];
      return { id: r.id, name: r.name, inviteCode: r.invite_code, createdAt: r.created_at, members: 0 };
    } catch (e) {
      if (e?.code === "23505") continue; // уникальный invite_code
      throw e;
    }
  }
  throw new TeacherError(500, "Не удалось сгенерировать код приглашения");
}

export async function renameClass(teacherId, classId, name) {
  await assertTeacher(teacherId);
  const trimmed = String(name ?? "").trim().slice(0, 80);
  if (trimmed.length < 1) throw new TeacherError(400, "Укажите название класса");
  const { rowCount } = await pool.query(
    "update public.teacher_classes set name = $1 where id = $2 and teacher_id = $3",
    [trimmed, classId, teacherId]
  );
  if (!rowCount) throw new TeacherError(404, "Класс не найден");
}

export async function deleteClass(teacherId, classId) {
  await assertTeacher(teacherId);
  const { rowCount } = await pool.query("delete from public.teacher_classes where id = $1 and teacher_id = $2", [classId, teacherId]);
  if (!rowCount) throw new TeacherError(404, "Класс не найден");
}

export async function listMembers(teacherId, classId) {
  await assertTeacher(teacherId);
  const own = await pool.query("select 1 from public.teacher_classes where id = $1 and teacher_id = $2", [classId, teacherId]);
  if (!own.rows[0]) throw new TeacherError(404, "Класс не найден");

  const { rows } = await pool.query(
    `select u.id, u.email, p.full_name, m.joined_at,
            (select count(*)::int from public.attempts a where a.user_id = u.id) as attempts,
            (select count(*)::int from public.attempts a where a.user_id = u.id and a.correct) as correct,
            (select count(*)::int from public.topic_reviews tr where tr.user_id = u.id) as review_topics,
            (select d.subject from public.diagnostics d where d.user_id = u.id order by d.finished_at desc limit 1) as last_diag_subject,
            (select d.result from public.diagnostics d where d.user_id = u.id order by d.finished_at desc limit 1) as last_diag_result
       from public.teacher_class_members m
       join auth.users u on u.id = m.student_id
       join public.profiles p on p.id = u.id
      where m.class_id = $1
      order by m.joined_at desc`,
    [classId]
  );

  return rows.map((r) => {
    const result = r.last_diag_result && typeof r.last_diag_result === "object" ? r.last_diag_result : {};
    return {
      id: r.id,
      email: r.email,
      name: r.full_name || r.email,
      joinedAt: r.joined_at,
      attempts: r.attempts,
      correct: r.correct,
      reviewTopics: r.review_topics,
      diagnostic: r.last_diag_subject
        ? {
            subject: r.last_diag_subject,
            subjectName: SUBJECT_NAMES[r.last_diag_subject] ?? r.last_diag_subject,
            level: result.level ?? null,
            scoreMin: result.estimatedScoreMin ?? null,
            scoreMax: result.estimatedScoreMax ?? null,
          }
        : null,
    };
  });
}

export async function removeMember(teacherId, classId, studentId) {
  await assertTeacher(teacherId);
  const own = await pool.query("select 1 from public.teacher_classes where id = $1 and teacher_id = $2", [classId, teacherId]);
  if (!own.rows[0]) throw new TeacherError(404, "Класс не найден");
  await pool.query("delete from public.teacher_class_members where class_id = $1 and student_id = $2", [classId, studentId]);
}

/** Ученик вступает по коду. */
export async function joinByCode(studentId, code) {
  const normalized = String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 6 || normalized.length > 8) throw new TeacherError(400, "Неверный код приглашения");
  const { rows } = await pool.query("select id, name from public.teacher_classes where invite_code = $1", [normalized]);
  if (!rows[0]) throw new TeacherError(404, "Класс с таким кодом не найден");
  await pool.query(
    `insert into public.teacher_class_members (class_id, student_id) values ($1, $2)
     on conflict do nothing`,
    [rows[0].id, studentId]
  );
  return { classId: rows[0].id, className: rows[0].name };
}

export async function myMemberships(studentId) {
  const { rows } = await pool.query(
    `select c.id, c.name, c.invite_code, m.joined_at, p.full_name as teacher_name
       from public.teacher_class_members m
       join public.teacher_classes c on c.id = m.class_id
       join public.profiles p on p.id = c.teacher_id
      where m.student_id = $1
      order by m.joined_at desc`,
    [studentId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    joinedAt: r.joined_at,
    teacherName: r.teacher_name,
  }));
}

export async function leaveClass(studentId, classId) {
  await pool.query("delete from public.teacher_class_members where class_id = $1 and student_id = $2", [classId, studentId]);
}
