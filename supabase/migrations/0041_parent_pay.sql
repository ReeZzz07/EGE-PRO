-- «Попросить родителя оплатить» (docker/api/parentPay.js). У школьников часто нет своей карты: ученик
-- отправляет родителю ссылку /pay-for/<токен> (в мессенджер или письмом), родитель без входа в аккаунт
-- выбирает тариф и платит картой или через СБП. Платёж записывается на аккаунт ученика, чек уходит
-- родителю на указанную им почту.
--
-- parent_links — ссылки (по одной действующей на ученика, живёт 14 дней, токен — длинная случайная
-- строка: по ссылке можно только оплатить тариф этому ученику и увидеть его имя и счётчики, больше
-- ничего). parent_link_events — журнал для статистики в админке (создана / отправлена / открыта /
-- начата оплата). parent_email_log — сколько писем и на какие адреса уходило: адрес хранится только
-- хешем, нужен для лимитов (не больше трёх писем на один адрес, не чаще раза в час от ученика).
create table public.parent_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index parent_links_user_idx on public.parent_links (user_id, created_at desc);

create table public.parent_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.parent_links (id) on delete cascade,
  kind text not null check (kind in ('created', 'shared', 'email_sent', 'email_failed', 'opened', 'pay_started')),
  channel text check (channel in ('copy', 'whatsapp', 'telegram', 'email', 'other')),
  created_at timestamptz not null default now()
);
create index parent_link_events_link_idx on public.parent_link_events (link_id, id);
create index parent_link_events_kind_idx on public.parent_link_events (kind, created_at);

create table public.parent_email_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  email_hash text not null,
  sent_at timestamptz not null default now()
);
create index parent_email_log_user_idx on public.parent_email_log (user_id, sent_at desc);
create index parent_email_log_hash_idx on public.parent_email_log (email_hash);

-- платёж родителя: какая ссылка и каким способом (card / sbp; null — способ выбирает сама ЮKassa)
alter table public.payments add column parent_link_id uuid references public.parent_links (id) on delete set null;
alter table public.payments add column pay_method text check (pay_method in ('card', 'sbp'));
create index payments_parent_link_idx on public.payments (parent_link_id) where parent_link_id is not null;

-- Всё это читает и пишет только API (владелец БД, RLS его не касается); через PostgREST — никто.
alter table public.parent_links enable row level security;
alter table public.parent_link_events enable row level security;
alter table public.parent_email_log enable row level security;
