-- public.tasks.subject был единственной "предметной" колонкой без CHECK-ограничения — profiles,
-- diagnostics, study_plans, profile_subjects, score_scales и exam_attempts все проверяют один и
-- тот же канонический список из 12 предметов, а tasks (0006_task_bank.sql) — нет. Импорт задания
-- (или ручная правка) с опечаткой в subject проходил молча и такое задание становилось навсегда
-- недоступным ни в одном интерфейсе, фильтрующем по предмету — без единой ошибки при импорте.
-- Перед добавлением constraint проверено: строк с subject вне списка в текущей базе нет.
alter table public.tasks add constraint tasks_subject_check
  check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base'));
