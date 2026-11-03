import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import BlogSidebar from "./BlogSidebar";
import type { BlogArticle } from "../lib/blog";

const article = (slug: string, pinned = false): BlogArticle => ({
  id: slug,
  slug,
  title: `Статья ${slug}`,
  excerpt: "Анонс",
  content: "",
  coverImage: null,
  isPublished: true,
  isPinned: pinned,
  visibleToGuests: true,
  publishedAt: Date.now(),
  scheduledAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe("BlogSidebar", () => {
  it("поиск фильтрует список и ведёт на статью", () => {
    const onNav = vi.fn();
    render(<BlogSidebar articles={[article("alpha"), article("beta", true)]} onNav={onNav} />);
    expect(screen.getByTestId("blog-sidebar")).toBeInTheDocument();
    expect(screen.getByText("Статья alpha")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Название или тема…"), { target: { value: "beta" } });
    expect(screen.queryByText("Статья alpha")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Статья beta"));
    expect(onNav).toHaveBeenCalledWith({ name: "blog-article", slug: "beta" });
  });

  it("показывает оглавление и быстрые ссылки", () => {
    const onNav = vi.fn();
    render(
      <BlogSidebar
        articles={[article("a")]}
        currentSlug="a"
        toc={[{ id: "sec-1", text: "Раздел один", level: 2 }]}
        onNav={onNav}
      />
    );
    expect(screen.getByRole("link", { name: "Раздел один" })).toHaveAttribute("href", "#sec-1");
    fireEvent.click(screen.getByRole("button", { name: "Тарифы" }));
    expect(onNav).toHaveBeenCalledWith({ name: "tariffs" });
  });
});
