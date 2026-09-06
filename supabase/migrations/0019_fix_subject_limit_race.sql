-- enforce_subject_limit (0014_profile_subjects.sql) считало занятые места плоским
-- select count(*) без какой-либо блокировки — два конкурентных insert для одного user_id (два
-- вкладки браузера, двойной клик) читали один и тот же "старый" count в отдельных транзакциях,
-- оба проходили проверку и оба коммитились, давая subjects_count+1 предметов вместо лимита тарифа.
-- Фикс — advisory-лок на user_id в начале функции: pg_advisory_xact_lock держится до конца
-- транзакции INSERT'а (которым и вызван триггер), так что второй конкурентный insert того же
-- пользователя блокируется на этом locke, пока первый не закоммитится — и увидит уже актуальный
-- count. Лок за hashtext(user_id) — блокирует только повторные обращения ОДНОГО пользователя, не
-- все inserts подряд.
create or replace function public.enforce_subject_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_admin_user boolean;
  cap int;
  used int;
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  select p.is_admin, coalesce(t.subjects_count, 2147483647)
    into is_admin_user, cap
    from public.profiles p
    left join public.tariffs t on t.id = p.tariff_id
    where p.id = new.user_id;

  if is_admin_user then
    return new;
  end if;

  select count(*) into used from public.profile_subjects where user_id = new.user_id;
  if used >= coalesce(cap, 2147483647) then
    raise exception 'Достигнут лимит предметов по текущему тарифу' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
