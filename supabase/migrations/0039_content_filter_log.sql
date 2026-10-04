-- Журнал срабатываний фильтра текста (docker/api/contentFilter.js): что и почему было отклонено в формах
-- обращений и отзывов. Нужен, чтобы видеть реальные попытки и подстраивать список слов и исключений (ложные
-- срабатывания), а не терять информацию о заблокированных сообщениях. Хранится усечённый фрагмент текста
-- (не больше 300 символов) без почты и IP — только хеш IP; записи старше 90 дней удаляются при очередной записи.
create table public.content_filter_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  target text not null check (target in ('feedback', 'reviews')),
  field text not null,
  reasons text[] not null default '{}',
  snippet text not null default '',
  user_id uuid references auth.users (id) on delete set null,
  ip_hash text
);

create index content_filter_log_created_idx on public.content_filter_log (created_at desc);

-- Пишет и читает только API (владелец БД); клиентам через PostgREST доступа нет.
alter table public.content_filter_log enable row level security;
