-- Настройки платформы, редактируемые только админом из UI (сейчас — выбор провайдера ИИ-репетитора
-- Anthropic/Qwen и его API-ключ). Ключ-значение, а не отдельные колонки — чтобы потом можно было
-- добавлять другие настройки без новых миграций.

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.app_settings enable row level security;

-- НЕТ политики для anon/обычных authenticated — читать и писать может только админ,
-- в отличие от content_blocks (там публичное чтение). Ключ API не должен быть виден никому, кроме админа.
create policy "app_settings_admin_all" on public.app_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
