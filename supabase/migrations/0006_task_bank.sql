-- Публикация банка заданий из scripts/import (output/<subject>) в БД — раздел "что дальше" из
-- scripts/import/README.md. Дополняет статический src/data/tasks.ts, не заменяет его:
-- статические задания остаются как есть, здесь — массово импортированные и модерируемые админом.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.tasks (
  id text primary key,
  subject text not null,
  topic text not null default '',
  ege_number int,
  answer_type text,
  bucket text not null check (bucket in ('auto', 'essay')),
  points int not null default 2,
  statement text not null,
  options jsonb,
  answer text,
  explanation text,
  hints jsonb not null default '[]'::jsonb,
  criteria jsonb,
  min_words int,
  confidence text,
  needs_review boolean not null default true,
  published boolean not null default false,
  source text not null default 'fipi_auto_solve',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_subject_idx on public.tasks (subject);
create index tasks_published_idx on public.tasks (published);

alter table public.tasks enable row level security;

-- опубликованные задания видит кто угодно (в т.ч. анонимные гости — банк заданий доступен без входа)
create policy "tasks_select_published" on public.tasks
  for select
  using (published = true);

-- админ видит вообще всё, включая то, что на проверке
create policy "tasks_select_admin" on public.tasks
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy "tasks_admin_write" on public.tasks
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ─────────────────────── task_media (картинки к заданиям) ───────────────────────
create table public.task_media (
  id bigint generated always as identity primary key,
  task_id text not null references public.tasks (id) on delete cascade,
  storage_path text not null,
  position int not null default 0
);

create index task_media_task_id_idx on public.task_media (task_id);

alter table public.task_media enable row level security;

create policy "task_media_select_published" on public.task_media
  for select
  using (exists (select 1 from public.tasks t where t.id = task_media.task_id and t.published = true));

create policy "task_media_select_admin" on public.task_media
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy "task_media_admin_write" on public.task_media
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

-- Storage: бакет для картинок заданий (публичный — диаграммы/графики не чувствительны,
-- взяты из открытого банка ФИПИ; publish-флаг задания это не отменяет, но упрощает раздачу).
-- Схема storage.* — часть облачного Supabase Storage; в локальном Docker-стеке (docker-compose.yml)
-- картинки лежат на диске и раздаёт их docker/api/server.js — там этой схемы нет, поэтому блок ниже
-- выполняется, только если storage.buckets реально существует (условно, чтобы одна и та же миграция
-- одинаково накатывалась и в облаке, и локально).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('task-media', 'task-media', true)
      on conflict (id) do nothing;

    execute 'create policy "task_media_storage_public_read" on storage.objects for select using (bucket_id = ''task-media'')';
    execute 'create policy "task_media_storage_admin_write" on storage.objects for all to authenticated
      using (bucket_id = ''task-media'' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
      with check (bucket_id = ''task-media'' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))';
  end if;
end $$;
