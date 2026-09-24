-- Рассылки из админки: письма пользователям, отобранным фильтром списка (см. docker/api/campaigns.js,
-- «Админка → Пользователи → Написать по фильтру»). Два вида: 'verify_link' — повторная ссылка подтверждения
-- почты тем, кто её не подтвердил; 'custom' — своё письмо-напоминание (тема/текст/кнопка задаются при создании).
--
-- email_campaigns — сама рассылка + снимок условий, по которым отбирали получателей (журнал «кто, когда, кому»);
-- email_campaign_recipients — по строке на получателя: письмо каждому уходит не больше одного раза
-- (первичный ключ), статус двигается pending → sending → sent | failed | skipped.
-- Читает и пишет только бэкенд (роль-владелец), пользователям таблицы не видны.
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('verify_link', 'custom')),
  subject text,
  body_text text,
  eyebrow text,
  cta_label text,
  cta_path text,
  footer text,
  filters jsonb not null default '{}'::jsonb,
  q text,
  exclude_recent boolean not null default true,
  status text not null default 'sending' check (status in ('sending', 'done', 'cancelled')),
  total int not null default 0,
  finished_at timestamptz
);

create table if not exists public.email_campaign_recipients (
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  primary key (campaign_id, user_id)
);

create index if not exists email_campaign_recipients_status_idx on public.email_campaign_recipients (campaign_id, status);
create index if not exists email_campaign_recipients_user_sent_idx on public.email_campaign_recipients (user_id, sent_at) where status = 'sent';

alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;
revoke all on public.email_campaigns from anon, authenticated;
revoke all on public.email_campaign_recipients from anon, authenticated;
