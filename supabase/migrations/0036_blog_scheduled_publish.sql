-- Отложенная публикация статей "Базы знаний" — админ выбирает дату/время в AdminBlog.tsx, а
-- фактическую публикацию (is_published=true) выполняет фоновый тикер docker/api/blogScheduler.js,
-- напрямую через pool (как lifecycle.js), а не через Supabase-shim/RLS: это серверный процесс, а не
-- запрос от имени пользователя. RLS-политики блога не трогаем — is_published остаётся единственным
-- условием публичной видимости (см. 0032_blog_articles.sql), scheduled_at сам по себе доступ не даёт.
alter table public.blog_articles add column scheduled_at timestamptz;

-- Частичный индекс — тикер каждую минуту ищет именно "черновик с наступившим временем публикации";
-- для уже опубликованных или незапланированных статей scheduled_at не участвует в этом запросе вовсе.
create index blog_articles_scheduled_idx on public.blog_articles (scheduled_at)
  where is_published = false and scheduled_at is not null;
