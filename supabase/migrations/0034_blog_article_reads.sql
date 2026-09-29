-- Отметки "пользователь открыл статью" — для счётчика новых статей на пункте меню "База знаний"
-- (Header.tsx). Только для авторизованных: гостям счётчик не нужен и не начисляется вовсе.
-- Паттерн — как в 0014_profile_subjects.sql: per-user-per-item join, RLS ограничивает каждого
-- своими же строками.
create table public.blog_article_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.blog_articles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create index blog_article_reads_user_id_idx on public.blog_article_reads (user_id);

alter table public.blog_article_reads enable row level security;

create policy "blog_article_reads_select_own" on public.blog_article_reads
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "blog_article_reads_insert_own" on public.blog_article_reads
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
