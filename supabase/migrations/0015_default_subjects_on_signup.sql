-- Каждому новому аккаунту сразу подключаем два обязательных для ЕГЭ предмета — русский язык и
-- математику базового уровня (см. src/lib/auth.tsx updateProfile — там же живёт переключение на
-- профильную математику, если на онбординге выбрана она). Лимиты предметов по тарифам
-- (free/аттестат = 2, вуз = 4, вуз+ = 5, см. 0009_tariffs.sql) явно рассчитаны на "2 обязательных +
-- N по выбору" — без этой миграции пользователь, зарегистрировавшийся не через онбординг (кнопка
-- «Регистрация» в шапке), оставался с пустым списком предметов и должен был добавлять их вручную.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.profile_subjects (user_id, subject)
  values (new.id, 'rus'), (new.id, 'math_base');

  return new;
end;
$$;

-- бэкофилл: у кого нет вообще ни одного предмета (ни через онбординг, ни вручную) — подключаем
-- рус+база, как и новым пользователям; у кого уже есть хотя бы один предмет — выбор не трогаем.
insert into public.profile_subjects (user_id, subject)
select p.id, x.subject
from public.profiles p
cross join (values ('rus'), ('math_base')) as x(subject)
where not exists (select 1 from public.profile_subjects ps where ps.user_id = p.id)
on conflict (user_id, subject) do nothing;
