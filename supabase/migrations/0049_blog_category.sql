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

-- Разовая раскладка уже опубликованных статей по эвристике заголовка/slug.
update public.blog_articles set category = case
  when title ~* 'родител' or slug ~* 'roditel' then 'parents'
  when title ~* 'стресс|мотивац|тревог' or slug ~* 'stress|motivac' then 'wellbeing'
  when title ~* 'изменен|КИМ|демоверс' or slug ~* 'izmenen|kim|aktual' then 'changes'
  when title ~* 'знакомств|платформ|как устроен|диагност' or slug ~* 'znakomst|platform|diagnostik|ege-pro' then 'platform'
  when title ~* 'литератур|истори|хими|англи|биолог|матем|физик|общество|информат|геогр|русск'
    or slug ~* 'literat|istor|him|angl|biolog|matem|fizik|obschest|informat|geograf|russk'
    then 'subjects'
  when title ~* 'как |совет|план|подготов|метод|разбор|критери'
    or slug ~* 'kak-|sovet|podgotov|metod'
    then 'method'
  else category
end
where category = 'other';
