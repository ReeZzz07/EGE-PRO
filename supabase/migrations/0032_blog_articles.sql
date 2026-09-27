-- База знаний / блог — публичные статьи (список + карточка), редактируются админом (AdminBlog.tsx).
-- RLS-паттерн — как в 0009_tariffs.sql: публичный select ограничен самим условием политики
-- (is_published = true), а не только UI-роутингом, так что угадать URL черновика по прямому запросу
-- к Supabase-shim невозможно.
create table public.blog_articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text not null,
  content text not null,
  cover_image text,
  is_published boolean not null default false,
  is_pinned boolean not null default false,
  -- ставится один раз при первой публикации (см. publishArticle в src/lib/blog.ts) и не
  -- перезаписывается при последующих правках уже опубликованной статьи, чтобы дата оставалась
  -- осмысленной; также задел под будущую задачу "уведомить подписчиков о статьях после X" (пока нет).
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

alter table public.blog_articles enable row level security;

create policy "blog_articles_select_published" on public.blog_articles
  for select
  using (is_published = true);

create policy "blog_articles_select_admin" on public.blog_articles
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy "blog_articles_admin_write" on public.blog_articles
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

-- public.set_updated_at() уже определена в 0006_task_bank.sql и переиспользуется как есть везде,
-- где нужен этот триггер (0009, 0012, ...) — здесь НЕ переопределяем функцию, только вызываем её.
create trigger blog_articles_set_updated_at
  before update on public.blog_articles
  for each row execute function public.set_updated_at();

create index blog_articles_published_order_idx
  on public.blog_articles (is_pinned desc, published_at desc)
  where is_published = true;
