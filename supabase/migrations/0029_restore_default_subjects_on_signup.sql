-- ИСПРАВЛЕНИЕ регрессии из 0027_profile_location_demographics.sql: та миграция пересоздала
-- handle_new_user() только с вставкой профиля (+ возраст/пол) и потеряла автоматическое подключение
-- русского языка и базовой математики при регистрации (см. 0015_default_subjects_on_signup.sql).
-- Из-за этого новые ученики с момента деплоя 0027 попадали в платформу с пустым списком предметов
-- («Предмет не подключён» на любом задании).
--
-- 1) Функция снова делает всё сразу: профиль (с возрастом и полом из 0027) + рус + математика (база).
-- 2) Задним числом добираем предметы тем, кто зарегистрировался с момента 0027: русский, если его нет;
--    математику (базу), если нет ни одного уровня математики. Лимит предметов тарифа (триггер
--    enforce_subject_limit) по-прежнему действует — если места нет, конкретный предмет пропускается.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, age, gender)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    nullif(new.raw_user_meta_data ->> 'age', '')::smallint,
    nullif(new.raw_user_meta_data ->> 'gender', '')
  );

  insert into public.profile_subjects (user_id, subject)
  values (new.id, 'rus'), (new.id, 'math_base');

  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.id
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.created_at >= timestamptz '2026-09-23 02:00:00+00' and not p.is_admin
  loop
    begin
      if not exists (select 1 from public.profile_subjects where user_id = r.id and subject = 'rus') then
        insert into public.profile_subjects (user_id, subject) values (r.id, 'rus');
      end if;
    exception when others then
      null;
    end;
    begin
      if not exists (select 1 from public.profile_subjects where user_id = r.id and subject in ('math', 'math_base')) then
        insert into public.profile_subjects (user_id, subject) values (r.id, 'math_base');
      end if;
    exception when others then
      null;
    end;
  end loop;
end;
$$;
