-- Разовая оплата тарифа на срок через ЮKassa (см. docker/api/yookassa.js, POST /payments/create,
-- POST /payments/yookassa/webhook). Каждая строка — одна попытка оплаты, не подписка: продление
-- тарифа — это новая строка с новым платежом, автосписаний нет (см. обсуждение перед реализацией).

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tariff_id text not null references public.tariffs (id),
  -- Сумма и скидка — снимок на момент создания платежа, а не ссылка на текущую цену тарифа/скидку
  -- пользователя: тариф или персональная скидка (profiles.discount_percent) могут измениться между
  -- созданием платежа и его оплатой (пользователь может думать над оплатой минутами), сумма к
  -- зачислению не должна плавать вместе с ними.
  amount_rub numeric(10, 2) not null check (amount_rub > 0),
  discount_percent smallint,
  period_days int not null default 30 check (period_days > 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'canceled')),
  provider text not null default 'yookassa',
  -- id платежа в самой ЮKassa — приходит из ответа на создание платежа, используется вебхуком,
  -- чтобы найти эту строку и переспросить ЮKassa о реальном статусе (см. комментарий в server.js
  -- про то, почему вебхуку нельзя доверять напрямую). Уникален, но может быть NULL кратко между
  -- вставкой строки и ответом ЮKassa на запрос создания платежа.
  provider_payment_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_user_id_idx on public.payments (user_id);

alter table public.payments enable row level security;

-- пользователь видит СВОИ платежи (история оплат в личном кабинете) — но не создаёт и не
-- редактирует их напрямую через PostgREST: это идёт только через доверенный api-сервис
-- (POST /payments/create создаёт запись суперпользователем, вебхук её обновляет), иначе кто угодно
-- мог бы сам себе дописать status='succeeded' и продлить тариф без реальной оплаты.
create policy "payments_select_own" on public.payments
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "payments_select_admin" on public.payments
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
