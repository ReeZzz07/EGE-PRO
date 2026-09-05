-- Пройденный набор заданий "Экзамен-режима" (см. lib/examVariant.ts) — сохраняется целиком после
-- завершения, чтобы ученик мог найти его в личном кабинете и пройти повторно тот же вариант
-- (см. StatsView.tsx). Аналог по структуре public.diagnostics (0001_init.sql) — тоже "снимок одной
-- сессии" с ответами и результатом в json, только здесь ещё и конкретный состав заданий важен.
create table public.exam_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base')),
  task_ids text[] not null,
  answers jsonb not null default '{}'::jsonb,
  primary_score int not null default 0,
  max_primary int not null default 0,
  secondary_score int,
  secondary_max int,
  scale_year int,
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index exam_attempts_user_id_idx on public.exam_attempts (user_id);

alter table public.exam_attempts enable row level security;

create policy "exam_attempts_select_own" on public.exam_attempts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "exam_attempts_insert_own" on public.exam_attempts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "exam_attempts_delete_own" on public.exam_attempts
  for delete to authenticated
  using ((select auth.uid()) = user_id);
