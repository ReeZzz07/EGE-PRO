-- Видимость статьи для гостей — некоторые статьи (например, более "продуктовые" разборы) админ
-- может оставить только для зарегистрированных, а не для любого посетителя с поисковика.
-- default true — по умолчанию как было раньше (все опубликованные статьи видны и гостям), админ
-- явно выключает видимость для конкретной статьи, а не наоборот.
alter table public.blog_articles add column visible_to_guests boolean not null default true;

-- Старая политика отдавала любому select'у (в т.ч. анониму) все is_published=true строки без
-- разбора — заменяем на пару: гостям (и вообще всем ролям, включая anon) видны только
-- is_published AND visible_to_guests; авторизованным — отдельная политика без этого условия,
-- которая по OR-семантике permissive-политик Postgres расширяет им доступ до ВСЕХ опубликованных
-- статей независимо от visible_to_guests (см. project memory: RLS-политики additive, не replace).
drop policy "blog_articles_select_published" on public.blog_articles;

create policy "blog_articles_select_published_guest" on public.blog_articles
  for select
  using (is_published = true and visible_to_guests = true);

create policy "blog_articles_select_published_authenticated" on public.blog_articles
  for select to authenticated
  using (is_published = true);
