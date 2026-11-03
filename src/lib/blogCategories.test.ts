import { describe, expect, it } from "vitest";
import { inferBlogCategory, isBlogCategoryId, normalizeBlogCategory } from "./blogCategories";

describe("blogCategories", () => {
  it("normalize / isBlogCategoryId", () => {
    expect(isBlogCategoryId("subjects")).toBe(true);
    expect(isBlogCategoryId("nope")).toBe(false);
    expect(normalizeBlogCategory("parents")).toBe("parents");
    expect(normalizeBlogCategory("x")).toBe("other");
  });

  it("inferBlogCategory по заголовку/slug", () => {
    expect(inferBlogCategory("Родителям на заметку", "roditelyam-na-zametku")).toBe("parents");
    expect(inferBlogCategory("Как справиться со стрессом перед ЕГЭ", "stress")).toBe("wellbeing");
    expect(inferBlogCategory("ЕГЭ: где смотреть актуальные изменения", "izmeneniya")).toBe("changes");
    expect(inferBlogCategory("Знакомство с ЕГЭ-ПРО", "znakomstvo-s-ege-pro")).toBe("platform");
    expect(inferBlogCategory("ЕГЭ по литературе: сочинение", "ege-po-literature")).toBe("subjects");
    expect(inferBlogCategory("Как пользоваться подсказками", "kak-polzovatsya-podskazkami")).toBe("method");
  });
});
