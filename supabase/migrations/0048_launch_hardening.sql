-- Классы учителя, флаг is_teacher, журнал клиентских ошибок.
-- Прогресс (attempts/diagnostics/study_plans/topic_reviews) уже есть — клиент читает их как
-- source of truth (см. src/lib/planStorage.ts, spacedReview.ts, store.tsx). RLS: клиент ходит
-- через docker/api (роль postgres обходит RLS) и через PostgREST со своими политиками.

-- ─────────────────────── profiles.is_teacher ───────────────────────
alter table public.profiles add column if not exists is_teacher boolean not null default false;

-- тот же принцип, что у is_admin: ученик не может сам себе выставить флаг через PostgREST
create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if not exists (
      select 1 from public.profiles where id = (select auth.uid()) and is_admin
    ) then
      new.is_admin := old.is_admin;
    end if;
  end if;
  if new.is_teacher is distinct from old.is_teacher then
    if not exists (
      select 1 from public.profiles where id = (select auth.uid()) and is_admin
    ) then
      new.is_teacher := old.is_teacher;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_admin_flag() from public, anon, authenticated;

-- ─────────────────────── teacher_classes ───────────────────────
create table if not exists public.teacher_classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6,8}$'),
  created_at timestamptz not null default now()
);

create index if not exists teacher_classes_teacher_id_idx on public.teacher_classes (teacher_id);

alter table public.teacher_classes enable row level security;

drop policy if exists "teacher_classes_select_own" on public.teacher_classes;
create policy "teacher_classes_select_own" on public.teacher_classes
  for select to authenticated
  using ((select auth.uid()) = teacher_id);

drop policy if exists "teacher_classes_insert_own" on public.teacher_classes;
create policy "teacher_classes_insert_own" on public.teacher_classes
  for insert to authenticated
  with check ((select auth.uid()) = teacher_id);

drop policy if exists "teacher_classes_update_own" on public.teacher_classes;
create policy "teacher_classes_update_own" on public.teacher_classes
  for update to authenticated
  using ((select auth.uid()) = teacher_id);

drop policy if exists "teacher_classes_delete_own" on public.teacher_classes;
create policy "teacher_classes_delete_own" on public.teacher_classes
  for delete to authenticated
  using ((select auth.uid()) = teacher_id);

-- ─────────────────────── teacher_class_members ───────────────────────
create table if not exists public.teacher_class_members (
  class_id uuid not null references public.teacher_classes (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create index if not exists teacher_class_members_student_id_idx on public.teacher_class_members (student_id);

alter table public.teacher_class_members enable row level security;

drop policy if exists "teacher_class_members_select_related" on public.teacher_class_members;
create policy "teacher_class_members_select_related" on public.teacher_class_members
  for select to authenticated
  using (
    (select auth.uid()) = student_id
    or exists (
      select 1 from public.teacher_classes c
      where c.id = class_id and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "teacher_class_members_insert_self" on public.teacher_class_members;
create policy "teacher_class_members_insert_self" on public.teacher_class_members
  for insert to authenticated
  with check ((select auth.uid()) = student_id);

drop policy if exists "teacher_class_members_delete_related" on public.teacher_class_members;
create policy "teacher_class_members_delete_related" on public.teacher_class_members
  for delete to authenticated
  using (
    (select auth.uid()) = student_id
    or exists (
      select 1 from public.teacher_classes c
      where c.id = class_id and c.teacher_id = (select auth.uid())
    )
  );

-- ─────────────────────── client_errors ───────────────────────
-- Пишет только api (postgres). Anon/authenticated через PostgREST не должны ни читать чужие
-- стеки, ни забивать таблицу напрямую.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('boundary', 'window', 'unhandled', 'unknown')),
  message text not null check (char_length(message) between 1 and 2000),
  stack text,
  url text,
  user_agent text
);

create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

revoke all on public.client_errors from anon, authenticated;
grant select, insert, delete on public.client_errors to service_role;
grant usage, select on sequence public.client_errors_id_seq to service_role;
