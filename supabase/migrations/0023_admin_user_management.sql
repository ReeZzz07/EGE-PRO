-- Раздел "Пользователи" в админке: карточка пользователя (тариф, предметы, до какой даты
-- оплачено), персональные скидки, и действия, которые требует 152-ФЗ (просмотр/экспорт/
-- редактирование/удаление или анонимизация персональных данных по запросу субъекта).

-- ─────────────────────── тариф: дата активации/окончания, персональная скидка ───────────────────────
-- До сих пор tariff_id был вечным — оплаты не было (см. 0009_tariffs.sql), "выбор тарифа" просто
-- писал код в профиль без срока. Здесь впервые появляется срок действия: NULL означает "без срока"
-- (бесплатный тариф или разово выданный админом бессрочный доступ), непустая дата в прошлом —
-- тариф истёк, и resolveUserTariffGate (см. docker/api/tariffGate.js) в этом случае откатывает
-- пользователя на условия бесплатного тарифа, как будто оплаты никогда не было.
alter table public.profiles add column tariff_activated_at timestamptz;
alter table public.profiles add column tariff_expires_at timestamptz;

-- Персональная скидка (в процентах от цены тарифа) — учитывается при следующей оплате/продлении;
-- самой оплаты пока нет (как и у tariff_id), это заготовка под неё же, см. AdminUsers.tsx.
alter table public.profiles add column discount_percent smallint check (discount_percent between 0 and 100);

-- Анонимизация (см. ниже) — момент, когда персональные данные аккаунта были стёрты по запросу, но
-- строки в истории (попытки, диагностика) сохранены для агрегатной статистики. Отличается от
-- полного удаления аккаунта (DELETE /admin/users/:id — обычный каскад по auth.users, как при
-- самостоятельном удалении). NULL — обычный, не анонимизированный аккаунт.
alter table public.profiles add column anonymized_at timestamptz;

-- Новые поля тарифа/анонимизации — только для доверенного admin-контекста (docker/api/server.js,
-- подключается суперпользователем, минуя PostgREST), иначе обычный пользователь мог бы через
-- прямой PostgREST-запрос сам себе продлить подписку, начислить скидку или снять анонимизацию.
--
-- ВАЖНО (обнаружено при разработке этой миграции): `revoke update (col) on table from role` НЕ
-- вычитает колонку из уже выданного ШИРОКОГО `grant update on all tables in schema public to
-- authenticated` (см. docker/pg-init/9999_grants.sql) — это два независимых списка привилегий
-- в Postgres, табличный grant не сужается точечным revoke конкретной колонки. Из-за этого
-- `revoke update (token_version) on public.profiles from authenticated` в
-- 0022_profiles_token_version.sql НЕ РАБОТАЛ: обычный пользователь мог PATCH-запросом к
-- /rest/v1/profiles выставить себе token_version = 0 сразу после смены пароля, полностью
-- обесценивая отзыв токена (проверено вручную: запрос проходил и правда менял значение в БД).
-- Правильный способ — снять табличный grant update целиком и выдать его заново только на
-- колонки, которые пользователь реально правит сам через PostgREST (см. updateProfile/setAvatar
-- в src/lib/auth.tsx) — тогда всё остальное отсутствует в UPDATE-привилегиях вообще, а не
-- просто "как бы" отозвано. is_admin в этот список не входит: он и не должен быть самостоятельно
-- редактируемым (защищён также триггером protect_admin_flag из 0003_admin_content.sql, но теперь
-- ещё и на уровне грантов — задел не помешает).
revoke update on public.profiles from authenticated;
grant update (full_name, grade, exam_year, goal, daily_minutes, primary_subject, onboarded_at, tariff_id, avatar_url) on public.profiles to authenticated;

-- ─────────────────────── журнал admin-действий с персональными данными ───────────────────────
-- Требование прозрачности/подотчётности из 152-ФЗ (ст. 18.1) — уметь показать, кто и когда
-- обращался к персональным данным пользователя: экспорт, правка (в т.ч. выдача скидки — она
-- идёт через тот же PATCH, см. AdminUsers.tsx), анонимизация, удаление. target_email — снимок
-- на момент действия, а не
-- ссылка на текущее состояние: после anonymize/delete у самой записи профиля этих данных уже не
-- будет, а в журнале должно остаться, что произошло. target_user_id — намеренно БЕЗ внешнего ключа
-- на auth.users: удаление пользователя не должно (и не может, при отсутствии FK) утащить за собой
-- запись о том, что его данные были удалены — это и есть журнал, доказывающий выполнение запроса.
create table public.admin_user_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  target_user_id uuid not null,
  target_email text not null,
  action text not null check (action in ('view_export', 'edit', 'anonymize', 'delete')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_user_actions enable row level security;

-- читает только админ; строк для insert/update/delete НЕТ ни для authenticated, ни для anon —
-- писать может только доверенный api-сервис (суперпользователь, минуя RLS), как и в остальные
-- поля выше — обычным PostgREST-запросом подделать или стереть запись журнала нельзя.
create policy "admin_user_actions_select_admin" on public.admin_user_actions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
