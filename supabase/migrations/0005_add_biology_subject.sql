-- Добавление предмета «Биология» (bio) в список допустимых значений subject/primary_subject.
-- Контент заданий по биологии добавлен статически в src/data/tasks.ts — здесь только расширение enum-подобных CHECK.

alter table public.profiles drop constraint profiles_primary_subject_check;
alter table public.profiles add constraint profiles_primary_subject_check
  check (primary_subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio'));

alter table public.diagnostics drop constraint diagnostics_subject_check;
alter table public.diagnostics add constraint diagnostics_subject_check
  check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio'));

alter table public.study_plans drop constraint study_plans_subject_check;
alter table public.study_plans add constraint study_plans_subject_check
  check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio'));
