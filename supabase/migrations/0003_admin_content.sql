-- Админка управления контентом лендинга (узкий срез раздела 2.4 ТЗ — без полноценных ролей/CMS).
-- profiles.is_admin — кто может редактировать; content_blocks — редактируемые секции лендинга.

alter table public.profiles add column is_admin boolean not null default false;

-- защита от повышения прав: пользователь не может сам себе выставить is_admin через обычный update своей строки
-- (RLS проверяет только владение строкой, а не конкретные колонки — эта защита нужна на уровне триггера).
create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    -- auth.uid() is null для сервисных/прямых SQL-обращений (доверенный контекст) — им разрешаем.
    if (select auth.uid()) is not null and not exists (
      select 1 from public.profiles where id = (select auth.uid()) and is_admin
    ) then
      new.is_admin := old.is_admin;
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_admin_flag_trigger
  before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- ─────────────────────── content_blocks (редактируемые секции лендинга) ───────────────────────
create table public.content_blocks (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.content_blocks enable row level security;

-- лендинг публичный — читать может кто угодно, включая анонимов
create policy "content_blocks_select_all" on public.content_blocks
  for select
  using (true);

-- писать может только администратор
create policy "content_blocks_admin_write" on public.content_blocks
  for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

-- сиды — совпадают с текущим содержимым лендинга, чтобы после подключения ничего не изменилось визуально
insert into public.content_blocks (key, data) values
  ('hero', '{
    "title": "Подготовка к ЕГЭ с ИИ-репетитором, который объясняет, а не решает за тебя",
    "highlight": "ИИ-репетитором",
    "subtitle": "Диагностика уровня, персональный план, задания из открытого банка ФИПИ, уровневые подсказки и проверка сочинений по критериям. Без списывания — с пониманием."
  }'::jsonb),
  ('capabilities', '[
    {"icon": "target", "t": "Диагностика уровня", "d": "8–12 заданий — и понятно, с чего начинать."},
    {"icon": "book", "t": "Персональный план", "d": "Что повторить сегодня, сколько тренироваться на неделе."},
    {"icon": "list", "t": "Задания формата ЕГЭ", "d": "Открытый банк ФИПИ, мгновенная проверка по эталону."},
    {"icon": "chat", "t": "ИИ-объяснения без готовых ответов", "d": "Наводит на решение вопросами, а не выдаёт результат."},
    {"icon": "check", "t": "Проверка сочинений и развёрнутых ответов", "d": "По критериям, с чёткими баллами по каждому пункту."},
    {"icon": "timer", "t": "Пробные варианты", "d": "Таймер, часть 1 и часть 2 — как на настоящем экзамене."}
  ]'::jsonb),
  ('process', '[
    {"n": "01", "icon": "target", "t": "Диагностика", "d": "8–12 заданий по предмету, 7–10 минут. Без подсказок — так точнее видно, что уже знаешь, а что нет."},
    {"n": "02", "icon": "book", "t": "Персональный план", "d": "На основе результатов — что повторить сегодня, сколько тренировок на неделе и когда пробник."},
    {"n": "03", "icon": "chat", "t": "Тренировки с ИИ", "d": "Решаешь задания, при затруднении — уровневые подсказки и объяснение темы, без готового ответа."},
    {"n": "04", "icon": "timer", "t": "Пробный вариант", "d": "Часть 1 и часть 2 на время, без подсказок — как на настоящем экзамене. Разбор после сдачи."}
  ]'::jsonb),
  ('faq', '[
    {"q": "Это официальный ресурс ФИПИ?", "a": "Нет. Это учебный проект, который ориентируется на формат Открытого банка заданий ФИПИ и демоверсии ЕГЭ, но не является официальным ресурсом ФИПИ или Рособрнадзора."},
    {"q": "ИИ даст готовый ответ, если попросить?", "a": "Нет, по конструкции. Даже если явно попросить — ИИ объяснит тему, задаст наводящий вопрос или разберёт похожий пример, но не назовёт финальный ответ твоего задания."},
    {"q": "Нужно заниматься каждый день?", "a": "Нет. На онбординге ты сам выбираешь темп — от 10 минут до часа в день, план подстраивается под это время."},
    {"q": "Прогресс сохранится, если я закрою вкладку?", "a": "Да, после регистрации план, диагностика и история попыток сохраняются в твоём аккаунте и доступны при следующем входе."}
  ]'::jsonb);
