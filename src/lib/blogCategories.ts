// Рубрики базы знаний — фиксированный словарь (сайдбар + админка). Значение в БД: blog_articles.category.

export const BLOG_CATEGORY_IDS = ["platform", "subjects", "method", "parents", "wellbeing", "changes", "other"] as const;
export type BlogCategoryId = (typeof BLOG_CATEGORY_IDS)[number];

export const BLOG_CATEGORIES: { id: BlogCategoryId; label: string }[] = [
  { id: "platform", label: "О платформе" },
  { id: "subjects", label: "По предметам" },
  { id: "method", label: "Методика" },
  { id: "parents", label: "Родителям" },
  { id: "wellbeing", label: "Стресс и мотивация" },
  { id: "changes", label: "Изменения ЕГЭ" },
  { id: "other", label: "Другое" },
];

const LABEL = Object.fromEntries(BLOG_CATEGORIES.map((c) => [c.id, c.label])) as Record<BlogCategoryId, string>;

export function blogCategoryLabel(id: BlogCategoryId): string {
  return LABEL[id] ?? LABEL.other;
}

export function isBlogCategoryId(v: string | null | undefined): v is BlogCategoryId {
  return !!v && (BLOG_CATEGORY_IDS as readonly string[]).includes(v);
}

export function normalizeBlogCategory(v: string | null | undefined): BlogCategoryId {
  return isBlogCategoryId(v) ? v : "other";
}

/** Эвристика для старых статей без категории / подсказки в админке. */
export function inferBlogCategory(title: string, slug: string): BlogCategoryId {
  const t = `${title} ${slug}`.toLowerCase();
  if (/родител|roditel/.test(t)) return "parents";
  if (/стресс|мотивац|тревог|выгоран|stress|motivac/.test(t)) return "wellbeing";
  if (/изменен|ким.?202|демоверс|izmenen|kim.?202|aktual/.test(t)) return "changes";
  if (/знакомств|платформ|егэ.?про|диагност|как устроен|znakomst|platform|diagnostik|ege-pro|ege.?pro/.test(t)) return "platform";
  if (
    /литератур|истори|хими|англи|биолог|матем|физик|общество|информат|геогр|русск|literat|istor|him|angl|biolog|matem|fizik|obschest|informat|geograf|russk/.test(
      t
    )
  ) {
    return "subjects";
  }
  if (/как |совет|план|подготов|метод|разбор|критери|kak-|sovet|podgotov|metod/.test(t)) return "method";
  return "other";
}
