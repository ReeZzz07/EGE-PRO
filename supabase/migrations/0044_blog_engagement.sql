-- Под статьями блога: просмотры, лайки, репосты в соцсети и комментарии (docker/api/blogEngagement.js).
-- Смотреть, лайкать, делиться и читать комментарии может любой посетитель (в том числе без входа), писать
-- комментарии — только вошедший пользователь. Посетитель без входа определяется случайным идентификатором из
-- его браузера (viewer_key вида 'v:<uuid>'), вошедший — своим аккаунтом ('u:<uuid>'): так лайк и просмотр
-- не дублируются, а персональные данные (почта, имя) в счётчики не попадают. IP-адреса не хранятся.
--
-- Просмотр — один на посетителя в день (viewed_on), репост — один на посетителя, канал и день, лайк — один на
-- посетителя (повторный клик снимает). Строки со ссылкой на аккаунт (user_id) исчезают вместе с ним.
create table public.blog_article_views (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.blog_articles (id) on delete cascade,
  viewer_key text not null,
  user_id uuid references auth.users (id) on delete cascade,
  viewed_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (article_id, viewer_key, viewed_on)
);
create index blog_article_views_user_idx on public.blog_article_views (user_id) where user_id is not null;

create table public.blog_article_likes (
  article_id uuid not null references public.blog_articles (id) on delete cascade,
  viewer_key text not null,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, viewer_key)
);
create index blog_article_likes_user_idx on public.blog_article_likes (user_id) where user_id is not null;

-- copy — «скопировать ссылку»: считаем отдельно и в публичный счётчик «репостов в соцсети» не включаем
create table public.blog_article_shares (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.blog_articles (id) on delete cascade,
  viewer_key text not null,
  user_id uuid references auth.users (id) on delete cascade,
  channel text not null check (channel in ('vk', 'telegram', 'whatsapp', 'ok', 'copy')),
  shared_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (article_id, viewer_key, channel, shared_on)
);
create index blog_article_shares_user_idx on public.blog_article_shares (user_id) where user_id is not null;

create table public.blog_comments (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.blog_articles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 2000),
  created_at timestamptz not null default now()
);
create index blog_comments_article_idx on public.blog_comments (article_id, id desc);
create index blog_comments_user_idx on public.blog_comments (user_id, created_at desc);

-- Читает и пишет только API (владелец БД): через PostgREST никому, всё идёт через проверки в blogEngagement.js.
alter table public.blog_article_views enable row level security;
alter table public.blog_article_likes enable row level security;
alter table public.blog_article_shares enable row level security;
alter table public.blog_comments enable row level security;
revoke all on public.blog_article_views, public.blog_article_likes, public.blog_article_shares, public.blog_comments from anon, authenticated;
