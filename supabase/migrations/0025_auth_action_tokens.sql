-- Одноразовые токены для email-подтверждения регистрации и сброса пароля (см.
-- docker/api/authTokens.js, docker/api/mailer.js). Отдельная таблица в схеме auth, а не колонки
-- на auth.users — так один и тот же механизм обслуживает оба назначения (a) и не плодит колонки
-- под каждый будущий тип действия (например, смену email по ссылке). Схема auth НЕ входит в
-- PGRST_DB_SCHEMAS (см. docker-compose.yml/.prod.yml — там только "public") — эта таблица в
-- принципе недостижима через PostgREST, к ней обращается только доверенный api-сервис
-- (подключается суперпользователем напрямую к Postgres, см. docker/api/db.js), что здесь и нужно:
-- хеши токенов не должны быть доступны обычным authenticated-запросам ни при какой RLS-политике.
create table auth.action_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  -- Хранится хеш (sha256), не сам токен — как и пароли, токен не должен быть восстановим из
  -- дампа БД. Не bcrypt: токен уже сам по себе высокоэнтропийный случайный секрет (см.
  -- authTokens.js, 32 случайных байта), медленное хеширование здесь защищало бы не от подбора
  -- (подобрать 256 бит перебором нереально в любом случае), а только замедляло бы наши же запросы.
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index action_tokens_hash_idx on auth.action_tokens (token_hash);
create index action_tokens_user_purpose_idx on auth.action_tokens (user_id, purpose);
