-- Расширение анкеты ученика: регион/город/школа (первый шаг онбординга, см. OnboardingFlow.tsx)
-- и возраст/пол (форма регистрации, см. AuthScreen.tsx). Регион/город сверяются на фронтенде со
-- справочником (src/data/geo.ts, 85 регионов + 1134 города), но здесь хранятся просто как text —
-- поле "город" всё равно принимает свободный ввод, если нужного города нет в списке (см.
-- комментарий в geo.ts), так что серверная валидация по списку не имеет смысла. Школа — вообще
-- свободный текст без справочника (полного открытого реестра школ РФ нет, см. обсуждение задачи).

alter table public.profiles add column region text;
alter table public.profiles add column city text;
alter table public.profiles add column school text;
alter table public.profiles add column age smallint check (age between 5 and 100);
alter table public.profiles add column gender text check (gender in ('m', 'f'));

-- Пользователь правит эти поля сам через PostgREST (регион/город/школа — на первом шаге
-- онбординга, но и позже, через Настройки; возраст/пол задаются один раз на регистрации, но тоже
-- редактируемы позже) — тот же принцип точечного grant по колонкам, что и у остальных
-- самостоятельно редактируемых полей профиля (см. 0023_admin_user_management.sql, где объясняется,
-- почему это grant, а не просто RLS-политика: широкий табличный grant update оттуда уже отозван).
grant update (region, city, school, age, gender) on public.profiles to authenticated;

-- Возраст/пол приходят уже при регистрации (см. POST /auth/signup в server.js — кладёт их в
-- raw_user_meta_data рядом с full_name) — handle_new_user должен забрать их в profiles сразу же,
-- тем же способом, что full_name. Регион/город/школа сюда не входят — они появляются позже, на
-- первом шаге онбординга, через обычный updateProfile(), отдельная вставка при регистрации им не
-- нужна. nullif(...,'')::smallint — raw_user_meta_data всегда jsonb-строки, а не понятие "нет
-- ключа"/NULL; ->> на отсутствующем ключе и так даёт SQL NULL, но на пустой строке (если фронтенд
-- всё же прислал '') — нужно явно превратить '' в NULL, иначе ::smallint упадёт с ошибкой каста.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, age, gender)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    nullif(new.raw_user_meta_data ->> 'age', '')::smallint,
    nullif(new.raw_user_meta_data ->> 'gender', '')
  );
  return new;
end;
$$;
