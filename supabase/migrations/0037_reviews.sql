-- Отзывы о сервисе. Оставить отзыв может только тот, кто прошёл онбординг, диагностику и минимум
-- 5 раз обращался к ИИ-репетитору — это проверяет сервер (docker/api/reviews.js), не клиент.
-- Один отзыв на пользователя; правка возвращает его на модерацию.
--
-- status:
--   private  — виден только команде: оценка 1–3 или нет согласия на публикацию (публично не показывается никогда);
--   pending  — оценка 4–5 и согласие есть, ждёт модерации;
--   approved — опубликован (лендинг, страница тарифов);
--   rejected — отклонён модератором.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 30 and 1500),
  subject text,
  display_name text not null check (char_length(display_name) between 2 and 40),
  consent_public boolean not null default false,
  status text not null default 'pending' check (status in ('private', 'pending', 'approved', 'rejected')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) <= 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index reviews_status_idx on public.reviews (status, published_at desc);

-- Писать в таблицу может только API (владелец БД, RLS его не касается); клиент через PostgREST —
-- только читать собственный отзыв. Публичную ленту отдаёт API (GET /reviews/public) без user_id.
alter table public.reviews enable row level security;

create policy "reviews_select_own" on public.reviews
  for select to authenticated
  using ((select auth.uid()) = user_id);
