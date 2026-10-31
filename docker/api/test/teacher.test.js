import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createClass, joinByCode, listClasses, listMembers, TeacherError } from "../teacher.js";
import { createTestUser, deleteTestUser, sweepLeftoverTestUsers, pool } from "./helpers.js";

before(sweepLeftoverTestUsers);
after(async () => {
  await sweepLeftoverTestUsers();
  await pool.end();
});

test("учитель: создать класс, ученик вступает по коду, виден в списке", async () => {
  const teacherId = await createTestUser();
  const studentId = await createTestUser();
  try {
    await pool.query("update public.profiles set is_teacher = true, full_name = 'Учитель Тест' where id = $1", [teacherId]);
    await pool.query("update public.profiles set full_name = 'Ученик Тест' where id = $1", [studentId]);

    await assert.rejects(() => createClass(studentId, "Класс"), (e) => e instanceof TeacherError && e.status === 403);

    const cls = await createClass(teacherId, "11А");
    assert.ok(cls.inviteCode.length >= 6);
    const classes = await listClasses(teacherId);
    assert.equal(classes.length, 1);
    assert.equal(classes[0].name, "11А");

    const joined = await joinByCode(studentId, cls.inviteCode.toLowerCase());
    assert.equal(joined.className, "11А");

    const members = await listMembers(teacherId, cls.id);
    assert.equal(members.length, 1);
    assert.equal(members[0].name, "Ученик Тест");
  } finally {
    await deleteTestUser(studentId);
    await deleteTestUser(teacherId);
  }
});
