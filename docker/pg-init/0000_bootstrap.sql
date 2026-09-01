-- Замена того, что в облачном Supabase настроено автоматически (не миграциями пользователя):
-- роли anon/authenticated/authenticator, схема auth с auth.uid()/auth.role(), таблица auth.users.
-- Должен применяться ДО supabase/migrations/000N_*.sql — они ссылаются на auth.users и auth.uid().

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'authenticator_local_pw';
  end if;
end $$;

grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  encrypted_password text not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- та же семантика, что у auth.uid()/auth.role() в облачном Supabase: читают JWT-клеймы,
-- которые PostgREST кладёт в GUC request.jwt.claims на время запроса.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', 'anon')
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- чтобы таблицы, которые появятся в БУДУЩИХ миграциях (после этого bootstrap-скрипта), сразу
-- получали нужные табличные GRANT — без этого пришлось бы вручную грантовать каждую новую
-- таблицу отдельно (наступили на эти грабли с public.app_settings — таблица появилась уже
-- после того, как разовый 9999_grants.sql отработал на старых таблицах).
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
