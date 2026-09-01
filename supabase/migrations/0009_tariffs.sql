-- Тарифы подписки — управляются администратором из админки (CRUD), видны всем на публичной
-- странице тарифов. Без оплаты (см. docs/tarifs.md, «Без оплаты пока» — эндпоинта оплаты нет):
-- «выбор» тарифа — это просто запись tariff_id в профиль, без списания денег. Кнопка выбора
-- намеренно вызывает один простой апдейт (updateProfile({tariffId}) в src/components/Tariffs.tsx)
-- — когда появится настоящий платёжный провайдер, там же меняется один вызов, остальное не трогаем.

create table public.tariffs (
  id text primary key,
  name text not null,
  badge text,
  price_rub int not null default 0,
  subjects_count int not null default 1,
  -- NULL = без дневного лимита обращений к ИИ-репетитору (платные тарифы); число — только на free
  daily_ai_limit int,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tariffs enable row level security;

-- страница тарифов публичная — читают активные тарифы даже анонимы (как лендинг)
create policy "tariffs_select_active" on public.tariffs
  for select
  using (is_active = true);

-- админ видит вообще всё, включая скрытые/архивные тарифы
create policy "tariffs_select_admin" on public.tariffs
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy "tariffs_admin_write" on public.tariffs
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create trigger tariffs_set_updated_at
  before update on public.tariffs
  for each row execute function public.set_updated_at();

-- сиды — совпадают с docs/tarifs.md (реальная версия после проверки экономики)
insert into public.tariffs (id, name, badge, price_rub, subjects_count, daily_ai_limit, sort_order, is_active) values
  ('free', 'Попробовать', 'Бесплатно', 0, 2, 3, 0, true),
  ('attestat', 'АТТЕСТАТ', null, 1990, 2, null, 1, true),
  ('vuz', 'ВУЗ', '🔥 Популярный выбор', 3990, 4, null, 2, true),
  ('vuz-plus', 'ВУЗ+', null, 4990, 5, null, 3, true);

-- тариф аккаунта — по умолчанию бесплатный; FK без "on delete cascade/set null" нарочно:
-- админ не может удалить тариф, пока на нём есть хоть один пользователь (см. AdminTariffs.tsx —
-- удаление тарифа с активными пользователями просто вернёт ошибку внешнего ключа).
-- Администраторы (profiles.is_admin) тариф игнорируют полностью — это проверяется в коде на
-- фронтенде и на сервере, а не через отдельный "безлимитный" тариф в этой таблице.
alter table public.profiles add column tariff_id text not null default 'free' references public.tariffs (id);
