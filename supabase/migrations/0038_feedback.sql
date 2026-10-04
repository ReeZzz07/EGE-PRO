-- Обратная связь (страница /contacts, docker/api/feedback.js). Каждое обращение пишется в БД ДО отправки
-- любых писем — поэтому оно не теряется, даже если SMTP недоступен. Всё, что происходит с обращением
-- (создано, письма команде/автору, смена статуса, заметки, ответы), добавляется в журнал feedback_events:
-- код только вставляет туда строки, не правит и не удаляет. Сами обращения удалить нельзя (триггер ниже);
-- при удалении/анонимизации аккаунта стираются только персональные данные автора (почта, имя, текст).
--
-- status: new → in_progress → answered → closed. «Просрочено» — new/in_progress без ответа дольше 24 часов
-- (считается запросом, в таблице не хранится).
create table public.feedback_messages (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  name text,
  topic text not null check (topic in ('payment', 'bug', 'task_error', 'suggestion', 'partnership', 'other')),
  message text not null check (char_length(message) between 10 and 3000),
  task_id text,
  source text,
  context jsonb not null default '{}'::jsonb,
  ip_hash text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'answered', 'closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  closed_at timestamptz,
  team_notified_at timestamptz,
  team_notify_error text,
  ack_sent_at timestamptz,
  ack_error text
);

create index feedback_messages_status_idx on public.feedback_messages (status, created_at desc);
create index feedback_messages_user_idx on public.feedback_messages (user_id);
create index feedback_messages_email_idx on public.feedback_messages (email);
create index feedback_messages_ip_idx on public.feedback_messages (ip_hash, created_at);

create table public.feedback_events (
  id bigint generated always as identity primary key,
  feedback_id bigint not null references public.feedback_messages (id) on delete cascade,
  type text not null check (type in ('created', 'team_notified', 'team_notify_failed', 'ack_sent', 'ack_failed', 'status_changed', 'note_changed', 'reply_sent', 'reply_failed')),
  actor_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index feedback_events_feedback_idx on public.feedback_events (feedback_id, id);

-- Писать в таблицы может только API (владелец БД, RLS его не касается). Автор через PostgREST видит
-- только свои обращения; журнал событий клиенту не отдаётся вовсе (в нём служебные записи).
alter table public.feedback_messages enable row level security;
alter table public.feedback_events enable row level security;

create policy "feedback_messages_select_own" on public.feedback_messages
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Обращения не удаляются: защита от случайного delete (штатно удалять их незачем — см. шапку).
create function public.feedback_forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Обращения не удаляются — смени статус на «closed»';
end;
$$;

create trigger feedback_messages_no_delete
  before delete on public.feedback_messages
  for each row execute function public.feedback_forbid_delete();

-- Персональные данные автора при удалении/анонимизации аккаунта: сами обращения и журнал остаются
-- (история и статистика), но почта, имя, текст, адрес-хеш и тексты наших ответов стираются.
create function public.scrub_feedback_for_user(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.feedback_events e
     set data = e.data - 'text'
   where e.feedback_id in (select id from public.feedback_messages where user_id = uid);
  update public.feedback_messages
     set email = '[удалено]', name = null, message = '[удалено по запросу пользователя]',
         ip_hash = null, context = '{}'::jsonb, admin_note = null
   where user_id = uid;
end;
$$;

create function public.feedback_scrub_on_user_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.scrub_feedback_for_user(old.id);
  return old;
end;
$$;

create trigger feedback_scrub_before_user_delete
  before delete on auth.users
  for each row execute function public.feedback_scrub_on_user_delete();
