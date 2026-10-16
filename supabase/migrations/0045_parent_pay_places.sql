-- «Попросить родителя оплатить»: откуда ученик нажал кнопку и дошла ли ссылка до оплаты (docker/api/parentPay.js).
--
-- До этого журнал знал только «ссылка создана / отправлена / открыта», но не то, В КАКОМ месте платформы ученик
-- нажал кнопку (лимит ИИ, итог диагностики, страница тарифов…) — без этого нельзя понять, какое место работает.
-- Новое событие requested + колонка place. Список мест задаёт API (PLACES в parentPay.js), здесь он не ограничен,
-- чтобы добавление нового места не требовало миграции.
alter table public.parent_link_events add column place text;

alter table public.parent_link_events drop constraint parent_link_events_kind_check;
alter table public.parent_link_events
  add constraint parent_link_events_kind_check
  check (kind in ('created', 'requested', 'shared', 'email_sent', 'email_failed', 'opened', 'pay_started'));

create index parent_link_events_place_idx on public.parent_link_events (place, created_at) where kind = 'requested';
