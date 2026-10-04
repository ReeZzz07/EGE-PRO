-- Откуда пришёл пользователь: метки рекламы (utm_*, yclid/gclid), реферер и страница входа в момент регистрации
-- (клиент собирает их при первом заходе, см. src/lib/attribution.ts, и присылает в POST /auth/signup).
-- Нужно, чтобы отчёт в /admin → Источники показывал по каждой кампании не только регистрации, но и
-- подтверждения почты, диагностику и оплаты. Метки — не персональные данные (идентификаторов человека в них нет).
-- first_touch — самый первый заход в этом браузере; last_touch — последний заход с метками (иначе совпадает с первым).
create table public.signup_attribution (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_touch jsonb not null default '{}'::jsonb,
  last_touch jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Пишет и читает только API (владелец БД); клиентам через PostgREST доступа нет.
alter table public.signup_attribution enable row level security;
