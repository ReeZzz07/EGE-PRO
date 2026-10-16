// Плашка на главной «родитель ещё не открыл твою ссылку»: только в состоянии waiting, с кнопкой «Отправить ещё раз».
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ParentLinkReminder from "./ParentLinkReminder";
import * as api from "../lib/parentPay";
import { reachGoalOnce } from "../lib/metrika";

vi.mock("../lib/metrika", () => ({ reachGoalOnce: vi.fn() }));
vi.mock("../lib/parentPay", async (orig) => ({ ...(await orig<typeof import("../lib/parentPay")>()), getParentLinkStatus: vi.fn() }));
vi.mock("./ParentPayModal", () => ({ default: ({ place }: { place: string }) => <div data-testid="parent-modal" data-place={place} /> }));

beforeEach(() => vi.clearAllMocks());

describe("ParentLinkReminder", () => {
  it("родитель не открыл ссылку больше суток: плашка со сроком ссылки; «Отправить ещё раз» открывает окно с местом reminder", async () => {
    vi.mocked(api.getParentLinkStatus).mockResolvedValue({ state: "waiting", sentAt: "2026-10-10T10:00:00Z", expiresAt: "2026-10-24T10:00:00Z" });
    render(<ParentLinkReminder />);
    const box = await screen.findByTestId("parent-link-reminder");
    expect(box).toHaveTextContent("Родитель ещё не открыл твою ссылку на оплату");
    expect(box).toHaveTextContent("Ссылка действует до 24 октября");
    expect(reachGoalOnce).toHaveBeenCalledWith("parent_reminder_seen", "parent_reminder_seen");
    expect(screen.queryByTestId("parent-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить ещё раз" }));
    expect(screen.getByTestId("parent-modal")).toHaveAttribute("data-place", "reminder");
  });

  it.each(["none", "sent", "opened", "paid"] as const)("состояние %s: плашки нет", async (state) => {
    vi.mocked(api.getParentLinkStatus).mockResolvedValue({ state });
    const { container } = render(<ParentLinkReminder />);
    await waitFor(() => expect(api.getParentLinkStatus).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(reachGoalOnce).not.toHaveBeenCalled();
  });
});
