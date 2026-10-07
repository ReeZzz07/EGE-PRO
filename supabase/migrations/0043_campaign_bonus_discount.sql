-- Дополнительная скидка из рассылки: тем, у кого приветственная скидка уже закончилась, письмо может
-- подарить новую скидку на первую оплату на ограниченный срок (docker/api/campaigns.js).
-- user_bonus_discounts — выданные скидки; getWelcomeOffer (offers.js) учитывает действующую как оффер, поэтому
-- она сама попадает в цену при оплате, в плашки на сайте и в письма. На одного получателя в одной рассылке
-- максимум одна выдача. Процент и срок рассылки хранятся в самой рассылке (журнал «кому и что обещали»).
alter table public.email_campaigns add column bonus_percent int check (bonus_percent between 1 and 50);
alter table public.email_campaigns add column bonus_hours int check (bonus_hours between 1 and 336);

create table public.user_bonus_discounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  percent int not null check (percent between 1 and 50),
  expires_at timestamptz not null,
  campaign_id uuid references public.email_campaigns (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index user_bonus_discounts_campaign_user_idx on public.user_bonus_discounts (campaign_id, user_id) where campaign_id is not null;
create index user_bonus_discounts_user_idx on public.user_bonus_discounts (user_id, expires_at);

-- читает и пишет только API (владелец БД); пользователям таблица не видна
alter table public.user_bonus_discounts enable row level security;
revoke all on public.user_bonus_discounts from anon, authenticated;
