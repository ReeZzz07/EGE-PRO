-- ЕГЭ·ПРО — базовая схема MVP (см. .docs/TZ.md разделы 13, 14)
-- Контент заданий (subjects/tasks/criteria) остаётся статическим в репозитории (src/data/tasks.ts) —
-- здесь хранятся только пользовательские данные: профиль, попытки, диагностика, план, развёрнутые ответы, чат с ИИ.

-- ─────────────────────── profiles ───────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  grade text check (grade in ('10', '11', 'grad')),
  exam_year int,
  goal text check (goal in ('threshold', '70plus', '80plus', 'olympiad')),
  daily_minutes int,
  primary_subject text check (primary_subject in ('math', 'rus', 'inf', 'fiz', 'soc')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id);

-- профиль создаётся автоматически триггером ниже; ручная вставка не нужна, но оставляем как страховку
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- автосоздание профиля при регистрации (стандартный паттерн Supabase)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────── attempts (попытки решения заданий) ───────────────────────
create table public.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  given text not null default '',
  correct boolean not null,
  seconds int not null default 0,
  created_at timestamptz not null default now()
);

create index attempts_user_id_idx on public.attempts (user_id);

alter table public.attempts enable row level security;

create policy "attempts_select_own" on public.attempts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "attempts_insert_own" on public.attempts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "attempts_delete_own" on public.attempts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ─────────────────────── diagnostics (результаты диагностики) ───────────────────────
create table public.diagnostics (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (subject in ('math', 'rus', 'inf', 'fiz', 'soc')),
  finished_at timestamptz not null default now(),
  answers jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index diagnostics_user_id_idx on public.diagnostics (user_id);

alter table public.diagnostics enable row level security;

create policy "diagnostics_select_own" on public.diagnostics
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "diagnostics_insert_own" on public.diagnostics
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ─────────────────────── study_plans (персональный план) ───────────────────────
create table public.study_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (subject in ('math', 'rus', 'inf', 'fiz', 'soc')),
  generated_at timestamptz not null default now(),
  items jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index study_plans_user_id_idx on public.study_plans (user_id);

alter table public.study_plans enable row level security;

create policy "study_plans_select_own" on public.study_plans
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "study_plans_insert_own" on public.study_plans
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ─────────────────────── essay_submissions / essay_assessments (развёрнутые ответы) ───────────────────────
create table public.essay_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  draft_number int not null default 1,
  text text not null,
  created_at timestamptz not null default now()
);

create index essay_submissions_user_id_idx on public.essay_submissions (user_id);

alter table public.essay_submissions enable row level security;

create policy "essay_submissions_select_own" on public.essay_submissions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "essay_submissions_insert_own" on public.essay_submissions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create table public.essay_assessments (
  id bigint generated always as identity primary key,
  submission_id bigint not null references public.essay_submissions (id) on delete cascade,
  criteria jsonb not null default '[]'::jsonb,
  total_score int not null default 0,
  max_score int not null default 0,
  summary text,
  created_at timestamptz not null default now()
);

create index essay_assessments_submission_id_idx on public.essay_assessments (submission_id);

alter table public.essay_assessments enable row level security;

-- доступ к оценке — только если владеешь соответствующим черновиком
create policy "essay_assessments_select_own" on public.essay_assessments
  for select to authenticated
  using (
    exists (
      select 1 from public.essay_submissions s
      where s.id = essay_assessments.submission_id
        and s.user_id = (select auth.uid())
    )
  );

-- вставку оценок делает ai-tutor Edge Function сервисной ролью (обходит RLS), клиент не пишет в эту таблицу напрямую.
-- Оставляем insert-политику на случай прямой записи с клиента (см. EssayView.tsx), чтобы демо работало и без Edge Function.
create policy "essay_assessments_insert_own" on public.essay_assessments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.essay_submissions s
      where s.id = essay_assessments.submission_id
        and s.user_id = (select auth.uid())
    )
  );

-- ─────────────────────── ai_messages (аудит переписки с ИИ-репетитором, раздел 14.4 ТЗ) ───────────────────────
create table public.ai_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text,
  mode text,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index ai_messages_user_id_idx on public.ai_messages (user_id);

alter table public.ai_messages enable row level security;

create policy "ai_messages_select_own" on public.ai_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- запись — только сервисной ролью из Edge Function (аудит-лог, клиент не должен подделывать историю)

-- ─────────────────────── hints_used (какие уровни подсказок запрашивались) ───────────────────────
create table public.hints_used (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  level int not null,
  created_at timestamptz not null default now()
);

create index hints_used_user_id_idx on public.hints_used (user_id);

alter table public.hints_used enable row level security;

create policy "hints_used_select_own" on public.hints_used
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- запись — только сервисной ролью из Edge Function
