-- Многопредметность: тарифы обещают "N предметов на выбор" (public.tariffs.subjects_count), но
-- до сих пор у профиля была только одна колонка primary_subject — выбрать второй предмет было
-- физически негде. profile_subjects — полный список активных предметов ученика, primary_subject
-- не трогаем и не удаляем (он остаётся тем предметом, что выбрали при онбординге, и фронтенд по
-- прежнему может на него полагаться как на "предмет по умолчанию" — subjects[0] после бэкофилла).
create table public.profile_subjects (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (subject = any (array['math','rus','inf','fiz','soc','bio','eng','geo','chem','hist','lit','math_base'])),
  added_at timestamptz not null default now(),
  unique (user_id, subject)
);

create index profile_subjects_user_id_idx on public.profile_subjects (user_id);

alter table public.profile_subjects enable row level security;

create policy "profile_subjects_select_own" on public.profile_subjects
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "profile_subjects_insert_own" on public.profile_subjects
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "profile_subjects_delete_own" on public.profile_subjects
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Лимит числа предметов по тарифу — здесь, а не только в форме на клиенте: RLS insert-политика
-- выше не видит других таблиц, поэтому настоящая защита — триггер. Админы (см. Tariffs.tsx) тариф
-- игнорируют полностью, как и во всех остальных ограничениях ИИ-репетитора (docker/api/server.js).
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

create trigger enforce_subject_limit_trigger
  before insert on public.profile_subjects
  for each row execute function public.enforce_subject_limit();

-- бэкофилл — у кого уже выбран primary_subject, тот и так один предмет "занимает"
insert into public.profile_subjects (user_id, subject)
select id, primary_subject from public.profiles where primary_subject is not null
on conflict (user_id, subject) do nothing;
