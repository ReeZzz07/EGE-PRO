-- Базовые табличные GRANT (в облачном Supabase выставлены автоматически на платформе).
-- Реальные ограничения на строки — через RLS-политики из миграций, это не отменяют,
-- а лишь открывает "разрешено пытаться" на уровне таблиц/схемы.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on auth.users to service_role;

-- client_errors пишет только api (postgres / service_role); после «grant all» выше отбираем
-- права у anon/authenticated, иначе любой мог бы забивать журнал через PostgREST.
revoke all on table public.client_errors from anon, authenticated;
