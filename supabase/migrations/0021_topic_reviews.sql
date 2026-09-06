-- Интервальное повторение (раздел 3.4 ТЗ): если ученик ошибся в теме, платформа должна вернуть
-- похожее задание по этой теме через 1 день, 3 дня, неделю и т.д. — растущий интервал закрепляет
-- знание в долгосрочной памяти, а не только в моменте (см. src/lib/spacedReview.ts).
--
-- Источник истины — localStorage на клиенте (тот же принцип, что у diagnostics/study_plans, см.
-- планировщик в lib/planStorage.ts: "DB — только зеркало, никогда не читается обратно"), эта
-- таблица — write-only зеркало для устойчивости данных и видимости в БД, не читается приложением
-- обратно при построении расписания.
create table public.topic_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (subject in ('math', 'rus', 'inf', 'fiz', 'soc', 'bio', 'eng', 'geo', 'chem', 'hist', 'lit', 'math_base')),
  topic text not null,
  stage int not null default 0,
  due_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (user_id, subject, topic)
);

create index topic_reviews_user_id_idx on public.topic_reviews (user_id);

alter table public.topic_reviews enable row level security;

create policy "topic_reviews_select_own" on public.topic_reviews
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "topic_reviews_insert_own" on public.topic_reviews
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "topic_reviews_update_own" on public.topic_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "topic_reviews_delete_own" on public.topic_reviews
  for delete to authenticated
  using ((select auth.uid()) = user_id);
