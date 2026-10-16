// Кнопка «Попросить родителя оплатить» в лимите ИИ и после диагностики: кому показывается и какое место уходит в статистику.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ParentPayLink from "./ParentPayLink";
import DiagnosticParentCard from "./DiagnosticParentCard";

let auth: { profile: { isAdmin: boolean; tariffId: string } | null; isGuestMode: boolean };
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("./ParentPayModal", () => ({ default: ({ place, onClose }: { place: string; onClose: () => void }) => <div data-testid="parent-modal" data-place={place}><button onClick={onClose}>закрыть</button></div> }));

beforeEach(() => {
  auth = { profile: { isAdmin: false, tariffId: "free" }, isGuestMode: false };
});

describe("ParentPayLink", () => {
  it("ученику показывает кнопку; клик открывает окно с переданным местом, закрытие убирает окно", () => {
    render(<ParentPayLink place="ai-limit" />);
    expect(screen.queryByTestId("parent-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Нет карты? Попросить родителя оплатить" }));
    expect(screen.getByTestId("parent-modal")).toHaveAttribute("data-place", "ai-limit");
    fireEvent.click(screen.getByRole("button", { name: "закрыть" }));
    expect(screen.queryByTestId("parent-modal")).not.toBeInTheDocument();
  });

  it("админу, гостевому режиму и вышедшему из аккаунта кнопку не показывает", () => {
    auth = { profile: { isAdmin: true, tariffId: "free" }, isGuestMode: false };
    const { rerender, container } = render(<ParentPayLink place="ai-limit" />);
    expect(container).toBeEmptyDOMElement();
    auth = { profile: { isAdmin: false, tariffId: "free" }, isGuestMode: true };
    rerender(<ParentPayLink place="ai-limit" />);
    expect(container).toBeEmptyDOMElement();
    auth = { profile: null, isGuestMode: false };
    rerender(<ParentPayLink place="ai-limit" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DiagnosticParentCard", () => {
  it("после диагностики ученику на бесплатном тарифе: пояснение про лимит и кнопка с местом diagnostic-result", () => {
    render(<DiagnosticParentCard />);
    expect(screen.getByTestId("diag-parent")).toHaveTextContent("три раза в день");
    fireEvent.click(screen.getByRole("button", { name: "Попросить родителя оплатить" }));
    expect(screen.getByTestId("parent-modal")).toHaveAttribute("data-place", "diagnostic-result");
  });

  it("платному тарифу, админу и гостевому режиму блок не показывается", () => {
    auth = { profile: { isAdmin: false, tariffId: "vuz" }, isGuestMode: false };
    const { rerender, container } = render(<DiagnosticParentCard />);
    expect(container).toBeEmptyDOMElement();
    auth = { profile: { isAdmin: true, tariffId: "free" }, isGuestMode: false };
    rerender(<DiagnosticParentCard />);
    expect(container).toBeEmptyDOMElement();
    auth = { profile: { isAdmin: false, tariffId: "free" }, isGuestMode: true };
    rerender(<DiagnosticParentCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
