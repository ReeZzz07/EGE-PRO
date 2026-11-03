import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BlogSidebar from "./BlogSidebar";
import type { BlogArticle } from "../lib/blog";

const article = (slug: string, category: BlogArticle["category"] = "method"): BlogArticle => ({
  id: slug,
  slug,
  title: `Статья ${slug}`,
  excerpt: "Анонс",
  content: "",
  coverImage: null,
  isPublished: true,
  isPinned: false,
  category,
  visibleToGuests: true,
  publishedAt: Date.now(),
  scheduledAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe("BlogSidebar", () => {
  it("показывает рубрики со счётчиками, без простыни названий статей", () => {
    const onCategoryChange = vi.fn();
    render(
      <BlogSidebar
        articles={[article("a", "subjects"), article("b", "subjects"), article("c", "parents")]}
        onNav={vi.fn()}
        category={null}
        onCategoryChange={onCategoryChange}
      />
    );
    expect(screen.getByTestId("blog-sidebar")).toBeInTheDocument();
    const cats = screen.getByRole("navigation", { name: "Рубрики" });
    expect(cats).toHaveTextContent("По предметам");
    expect(cats).toHaveTextContent("Родителям");
    expect(cats).toHaveTextContent("2");
    expect(screen.queryByText("Статья a")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /По предметам/ }));
    expect(onCategoryChange).toHaveBeenCalledWith("subjects");
  });

  it("оглавление и быстрые ссылки на месте", () => {
    const onNav = vi.fn();
    render(
      <BlogSidebar
        articles={[article("a")]}
        currentSlug="a"
        currentCategory="method"
        toc={[{ id: "sec-1", text: "Раздел один", level: 2 }]}
        onNav={onNav}
      />
    );
    expect(screen.getByRole("link", { name: "Раздел один" })).toHaveAttribute("href", "#sec-1");
    fireEvent.click(screen.getByRole("button", { name: "Тарифы" }));
    expect(onNav).toHaveBeenCalledWith({ name: "tariffs" });
  });
});
