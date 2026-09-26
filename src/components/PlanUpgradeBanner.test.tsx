// Постоянная плашка «про тарифы» для тех, кто прошёл диагностику, но остался на free (см. PlanUpgradeBanner.tsx).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlanUpgradeBanner, { PLAN_UPGRADE_DISMISSED_KEY } from "./PlanUpgradeBanner";

const offer = { percent: 30, expiresAt: new Date(Date.now() + 50 * 3600 * 1000).toISOString() };

describe("PlanUpgradeBanner", () => {
  beforeEach(() => sessionStorage.clear());

  it("показывает предмет и до трёх слабых тем; без скидки блока скидки нет", () => {
    render(<PlanUpgradeBanner subjectName="Русский язык" weakTopics={["Паронимы", "Ударения", "НЕ с частями речи", "Пунктуация"]} offer={null} onNav={vi.fn()} />);
    expect(screen.getByText(/Русский язык/)).toBeInTheDocument();
    expect(screen.getByText(/Паронимы, Ударения, НЕ с частями речи/)).toBeInTheDocument();
    expect(screen.queryByText(/Пунктуация/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-upgrade-offer")).not.toBeInTheDocument();
  });

  it("без слабых тем — общий текст про лимит ИИ, плашка всё равно на месте", () => {
    render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={null} onNav={vi.fn()} />);
    expect(screen.getByTestId("plan-upgrade-banner")).toBeInTheDocument();
    expect(screen.getByText(/3 раза в день/)).toBeInTheDocument();
    expect(screen.queryByText(/Слабые темы/)).not.toBeInTheDocument();
  });

  it("пока скидка жива — процент и таймер показаны в самой плашке", () => {
    render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={offer} onNav={vi.fn()} />);
    expect(screen.getByTestId("plan-upgrade-offer")).toHaveTextContent("−30% на первую оплату");
  });

  it("кнопки ведут на тарифы и на план", () => {
    const onNav = vi.fn();
    render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={null} onNav={onNav} />);
    fireEvent.click(screen.getByRole("button", { name: /Смотреть тарифы/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "tariffs" });
    fireEvent.click(screen.getByRole("button", { name: /Открыть план/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "plan" });
  });

  it("кнопка сворачивает плашку; в пределах сессии она не возвращается при повторном показе (перемонтировании)", () => {
    const { unmount } = render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={null} onNav={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Свернуть/ }));
    expect(screen.queryByTestId("plan-upgrade-banner")).not.toBeInTheDocument();
    unmount();
    render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={null} onNav={vi.fn()} />);
    expect(screen.queryByTestId("plan-upgrade-banner")).not.toBeInTheDocument();
  });

  it("новая сессия (sessionStorage пуст) — плашка снова показывается", () => {
    sessionStorage.setItem(PLAN_UPGRADE_DISMISSED_KEY, "1");
    sessionStorage.clear(); // как открытие сайта в новой вкладке/визите
    render(<PlanUpgradeBanner subjectName="Физика" weakTopics={[]} offer={null} onNav={vi.fn()} />);
    expect(screen.getByTestId("plan-upgrade-banner")).toBeInTheDocument();
  });
});
