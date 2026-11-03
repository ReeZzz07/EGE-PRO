-- Рубрика статьи базы знаний (сайдбар категорий, фильтр /blog?cat=…).
alter table public.blog_articles
  add column if not exists category text not null default 'other';

alter table public.blog_articles
  drop constraint if exists blog_articles_category_check;

alter table public.blog_articles
  add constraint blog_articles_category_check
  check (category in ('platform', 'subjects', 'method', 'parents', 'wellbeing', 'changes', 'other'));

create index if not exists blog_articles_category_idx
  on public.blog_articles (category)
  where is_published = true;

-- Разовая раскладка по slug (ASCII) — без кириллицы в regex (ломается при пайпе Windows→psql).
update public.blog_articles set category = 'parents' where category = 'other' and slug ~* 'roditel';
update public.blog_articles set category = 'wellbeing' where category = 'other' and slug ~* 'stress|motivac';
update public.blog_articles set category = 'changes' where category = 'other' and slug ~* 'izmenen|aktual|kim';
update public.blog_articles set category = 'platform' where category = 'other' and slug ~* 'znakomst|platform|diagnostik|ege-pro|egepro';
update public.blog_articles set category = 'subjects' where category = 'other' and slug ~* 'literat|istor|him|angl|biolog|matem|fizik|obschest|informat|geograf|russk';
update public.blog_articles set category = 'method' where category = 'other' and slug ~* 'sovet|podgotov|metod|kak-|podskaz|repetitor|plan';
