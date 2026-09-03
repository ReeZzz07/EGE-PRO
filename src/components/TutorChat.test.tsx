// TutorChat — бейдж дневной квоты в шапке чата: честно показывает остаток бесплатного лимита ДО
// того, как ученик в него упрётся (см. docker/api server.js: /ai-tutor/quota, и
// docker/api/test/tariffGate.test.js — серверная сторона той же цифры). Клик по бейджу на
// исчерпанном лимите должен вести на тарифы, а не быть просто текстом.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TutorChat from "./TutorChat";
import { loadAiQuota } from "../lib/aiTutor";

vi.mock("../lib/store", () => ({
  useProgress: () => ({ derived: { mistakeIds: new Set(), solvedIds: new Set() } }),
}));
vi.mock("../lib/aiTutor", () => ({ loadAiQuota: vi.fn(), callAiTutor: vi.fn() }));

describe("TutorChat — бейдж квоты", () => {
  it("безлимитный тариф — обычная подпись, без упоминания лимита", async () => {
    vi.mocked(loadAiQuota).mockResolvedValue({ limited: false });
    render(<TutorChat />);
    await waitFor(() => expect(screen.getByText("онлайн · знает банк ФИПИ")).toBeInTheDocument());
    expect(screen.queryByText(/осталось/)).not.toBeInTheDocument();
  });

  it("free, ещё есть остаток — кликабельный бейдж с точной цифрой, обычный стиль", async () => {
    vi.mocked(loadAiQuota).mockResolvedValue({ limited: true, limit: 3, used: 1, remaining: 2 });
    render(<TutorChat />);
    const badge = await screen.findByRole("button", { name: /осталось 2 из 3 на сегодня/ });
    expect(badge.className).not.toMatch(/text-amber/);
  });

  it("free, лимит исчерпан (remaining=0) — выделен цветом и жирным, клик ведёт на тарифы", async () => {
    vi.mocked(loadAiQuota).mockResolvedValue({ limited: true, limit: 3, used: 3, remaining: 0 });
    const onNavigate = vi.fn();
    render(<TutorChat onNavigate={onNavigate} />);
    const badge = await screen.findByRole("button", { name: /осталось 0 из 3 на сегодня/ });
    expect(badge.className).toMatch(/text-amber/);

    fireEvent.click(badge);
    expect(onNavigate).toHaveBeenCalledWith("tariffs");
  });
});
