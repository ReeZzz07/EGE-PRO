-- Журнал одноразовых «жизненных» писем (напоминание тем, кто зарегистрировался, но не начал
-- заниматься; напоминание о брошенной оплате) — см. docker/api/lifecycle.js. Одна строка на пару
-- (пользователь, вид письма) = письмо каждого вида уходит не больше одного раза на человека,
-- даже если планировщик перезапустится или сработает дважды.
-- Читает и пишет только бэкенд (роль-владелец), пользователям таблица не нужна и не видна.
create table if not exists public.lifecycle_emails (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.lifecycle_emails enable row level security;
revoke all on public.lifecycle_emails from anon, authenticated;
