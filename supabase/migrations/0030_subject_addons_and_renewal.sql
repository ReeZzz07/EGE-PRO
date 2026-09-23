-- Докупка предметов к платному тарифу и продление «как было».
--
-- profiles.extra_subjects — сколько предметов сверх тарифа докуплено. Живёт ровно столько же, сколько
-- сам тариф (общий tariff_expires_at): докупка списывается пропорционально оставшимся дням, а при
-- продлении «с прежними настройками» (см. docker/api/payments.js, kind = 'renewal') восстанавливается
-- вместе с тарифом. После окончания срока значение НЕ обнуляется — это и есть «прежние настройки»,
-- которые предлагаем продлить; действует оно только пока тариф активен.
-- Колонка намеренно не в списке колонок, доступных ученику на UPDATE (см. 0023/0027) — меняет только
-- сервер после оплаты.
alter table public.profiles add column extra_subjects int not null default 0 check (extra_subjects between 0 and 20);

-- kind: 'tariff' — обычная покупка тарифа, 'renewal' — продление прежнего тарифа + докупленных
-- предметов, 'addon' — докупка предметов к действующему тарифу (period_days = сколько дней осталось).
alter table public.payments add column kind text not null default 'tariff' check (kind in ('tariff', 'renewal', 'addon'));
alter table public.payments add column extra_subjects int not null default 0 check (extra_subjects >= 0);

-- Лимит предметов теперь учитывает и срок тарифа, и докупку: пока тариф действует — предметы тарифа
-- + докупленные; после окончания срока — условия бесплатного тарифа (как и для лимитов ИИ-репетитора,
-- см. resolveUserTariffGate в docker/api/tariffGate.js). Считаем ВСЕ подключённые предметы, включая
-- «замороженные» после окончания тарифа: чтобы освободить место, их нужно отключить явно.
create or replace function public.enforce_subject_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_admin_user boolean;
  cap int;
  used int;
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  select p.is_admin,
         case
           when p.tariff_id <> 'free' and p.tariff_expires_at is not null and p.tariff_expires_at <= now()
             then (select f.subjects_count from public.tariffs f where f.id = 'free')
           else t.subjects_count + p.extra_subjects
         end
    into is_admin_user, cap
    from public.profiles p
    left join public.tariffs t on t.id = p.tariff_id
    where p.id = new.user_id;

  if is_admin_user then
    return new;
  end if;

  select count(*) into used from public.profile_subjects where user_id = new.user_id;
  if used >= coalesce(cap, 2147483647) then
    raise exception 'Достигнут лимит предметов по текущему тарифу' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
