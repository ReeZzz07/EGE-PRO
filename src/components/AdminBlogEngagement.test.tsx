// Админка «База знаний»: цифры по каждой статье (просмотры, лайки, репосты, комментарии) и модерация комментариев.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminBlog from "./AdminBlog";
import * as blog from "../lib/blog";
import * as api from "../lib/blogEngagement";

const push = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "admin-1", isAdmin: true } }) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push }) }));
vi.mock("./RichTextEditor", () => ({ default: () => null }));
vi.mock("../lib/blog", async (orig) => ({ ...(await orig<typeof import("../lib/blog")>()), loadAllArticlesAdmin: vi.fn() }));
vi.mock("../lib/blogEngagement", async (orig) => ({ ...(await orig<typeof import("../lib/blogEngagement")>()), loadAdminEngagement: vi.fn(), removeComment: vi.fn() }));

const article = (id: string, slug: string, isPublished: boolean): blog.BlogArticle => ({
  id, slug, title: `Статья ${slug}`, excerpt: "", content: "<p>x</p>", coverImage: null, isPublished, isPinned: false, visibleToGuests: true, publishedAt: isPublished ? Date.now() : null, scheduledAt: null, createdAt: Date.now(), updatedAt: Date.now(),
});
const COMMENT: api.AdminComment = { id: 7, body: "Спам-комментарий", createdAt: "2026-10-07T10:00:00Z", author: "Ольга", email: "olga@example.org", articleSlug: "a", articleTitle: "Статья a" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(blog.loadAllArticlesAdmin).mockResolvedValue([article("id-a", "a", true), article("id-b", "b", false)]);
  vi.mocked(api.loadAdminEngagement).mockResolvedValue({
    stats: { "id-a": { views: 1200, likes: 15, shares: 4, comments: 2 }, "id-b": { views: 0, likes: 0, shares: 0, comments: 0 } },
    comments: [COMMENT],
  });
});

describe("AdminBlog: статистика и модерация", () => {
  it("у каждой статьи, включая черновик, видны просмотры, лайки, репосты и комментарии", async () => {
    render(<AdminBlog />);
    const a = await screen.findByTestId("admin-stats-a");
    expect(a.textContent?.replace(/\s/g, " ")).toBe("Просмотры 1200 · Лайки 15 · Репосты 4 · Комментарии 2");
    expect(screen.getByTestId("admin-stats-b")).toHaveTextContent("Просмотры 0 · Лайки 0 · Репосты 0 · Комментарии 0");
  });

  it("последние комментарии с автором, почтой и статьёй; удаление после подтверждения обновляет список", async () => {
    vi.mocked(api.removeComment).mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminBlog />);
    const item = await screen.findByTestId("admin-comment");
    expect(item).toHaveTextContent("Ольга");
    expect(item).toHaveTextContent("olga@example.org");
    expect(item).toHaveTextContent("Статья a");
    expect(item).toHaveTextContent("Спам-комментарий");
    vi.mocked(api.loadAdminEngagement).mockResolvedValue({ stats: {}, comments: [] });
    fireEvent.click(within(item).getByRole("button", { name: /Удалить/ }));
    await waitFor(() => expect(api.removeComment).toHaveBeenCalledWith(7));
    expect(push).toHaveBeenCalledWith("Комментарий удалён", "ok");
    expect(await screen.findByText("Комментариев пока нет.")).toBeInTheDocument();
  });

  it("если не подтвердить удаление, комментарий остаётся и запрос не уходит", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminBlog />);
    const item = await screen.findByTestId("admin-comment");
    fireEvent.click(within(item).getByRole("button", { name: /Удалить/ }));
    expect(api.removeComment).not.toHaveBeenCalled();
    expect(screen.getByTestId("admin-comment")).toBeInTheDocument();
  });

  it("без данных от сервера админка работает как раньше: статьи на месте, цифр нет", async () => {
    vi.mocked(api.loadAdminEngagement).mockResolvedValue(null);
    render(<AdminBlog />);
    expect(await screen.findByText("Статья a")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-stats-a")).not.toBeInTheDocument();
    expect(screen.getByText("Комментариев пока нет.")).toBeInTheDocument();
  });
});
