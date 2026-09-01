-- Расширение списка предметов под импорт нового источника (NeoFamily) — английский, география,
-- химия, история, литература и математика базового уровня. + колонка section для реальной
-- иерархии раздел→тема из нового источника (topic хранит тему, section — раздел).

alter table public.profiles drop constraint profiles_primary_subject_check;
alter table public.profiles add constraint profiles_primary_subject_check
  check (primary_subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base'));

alter table public.diagnostics drop constraint diagnostics_subject_check;
alter table public.diagnostics add constraint diagnostics_subject_check
  check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base'));

alter table public.study_plans drop constraint study_plans_subject_check;
alter table public.study_plans add constraint study_plans_subject_check
  check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base'));

alter table public.tasks add column if not exists section text;
