// Список статей: под каждой карточкой — просмотры, лайки и комментарии (если сервер отдал цифры).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import BlogList from "./BlogList";
import * as blog from "../lib/blog";
import * as api from "../lib/blogEngagement";

vi.mock("../lib/useDocumentHead", () => ({ useDocumentHead: vi.fn() }));
vi.mock("../lib/blog", async (orig) => ({ ...(await orig<typeof import("../lib/blog")>()), loadPublishedArticles: vi.fn() }));
vi.mock("../lib/blogEngagement", async (orig) => ({ ...(await orig<typeof import("../lib/blogEngagement")>()), loadAllEngagement: vi.fn() }));

const article = (slug: string): blog.BlogArticle => ({
  id: slug, slug, title: `Статья ${slug}`, excerpt: "Анонс", content: "", coverImage: null, isPublished: true, isPinned: false, visibleToGuests: true, publishedAt: Date.now(), scheduledAt: null, createdAt: Date.now(), updatedAt: Date.now(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(blog.loadPublishedArticles).mockResolvedValue([article("a"), article("b")]);
});

describe("BlogList: счётчики в карточках", () => {
  it("показывает просмотры, лайки и комментарии у статей, для которых сервер отдал цифры", async () => {
    vi.mocked(api.loadAllEngagement).mockResolvedValue({ a: { views: 1500, likes: 12, shares: 3, comments: 4 } });
    render(<BlogList onNav={vi.fn()} />);
    const counters = await screen.findByTestId("counters-a");
    await waitFor(() => expect(counters.textContent?.replace(/\s/g, " ")).toContain("1 500"));
    expect(counters).toHaveTextContent("♥ 12");
    expect(counters.textContent).toContain("4");
    expect(screen.queryByTestId("counters-b")).not.toBeInTheDocument();
  });

  it("если цифры не пришли (сбой), список выглядит как раньше", async () => {
    vi.mocked(api.loadAllEngagement).mockResolvedValue({});
    render(<BlogList onNav={vi.fn()} />);
    expect(await screen.findByText("Статья a")).toBeInTheDocument();
    expect(screen.queryByTestId("counters-a")).not.toBeInTheDocument();
  });
});
