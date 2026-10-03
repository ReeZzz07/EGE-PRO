import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WelcomeOfferBanner, { OfferStepHint } from "./WelcomeOfferBanner";
import { useWelcomeOffer, type WelcomeOffer } from "../lib/offers";

vi.mock("../lib/offers", () => ({ useWelcomeOffer: vi.fn() }));

const make = (earned: [boolean, boolean, boolean]): WelcomeOffer => ({
  percent: earned.filter(Boolean).length * 10,
  maxPercent: 30,
  expiresAt: new Date(Date.now() + 50 * 3600 * 1000).toISOString(),
  steps: [
    { key: "confirm", percent: 10, earned: earned[0] },
    { key: "onboarding", percent: 10, earned: earned[1] },
    { key: "diagnostic", percent: 10, earned: earned[2] },
  ],
});

describe("WelcomeOfferBanner", () => {
  it("после подтверждения почты: −10% сейчас, чек-лист шагов, каждый невыполненный шаг — кнопка", () => {
    const onNav = vi.fn();
    render(<WelcomeOfferBanner offer={make([true, false, false])} onNav={onNav} />);
    expect(screen.getByText(/−10% на первую оплату/)).toBeInTheDocument();
    expect(screen.getByText(/вырастет до/)).toHaveTextContent("−30%");
    const list = screen.getByTestId("offer-steps");
    expect(list).toHaveTextContent("Подтверждение почты −10%");
    fireEvent.click(screen.getByRole("button", { name: /Онбординг \+10%/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "onboarding" });
    fireEvent.click(screen.getByRole("button", { name: /Диагностика \+10%/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "diagnostic" });
    fireEvent.click(screen.getByRole("button", { name: /Выбрать тариф/ }));
    expect(onNav).toHaveBeenLastCalledWith({ name: "tariffs" });
  });

  it("онбординг пройден: он отмечен, осталась кнопка диагностики", () => {
    const onNav = vi.fn();
    render(<WelcomeOfferBanner offer={make([true, true, false])} onNav={onNav} />);
    expect(screen.getByText(/−20% на первую оплату/)).toBeInTheDocument();
    expect(screen.getByTestId("offer-steps")).toHaveTextContent("Онбординг −10%");
    expect(screen.queryByRole("button", { name: /Онбординг/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Диагностика \+10%/ }));
    expect(onNav).toHaveBeenCalledWith({ name: "diagnostic" });
  });

  it("все шаги пройдены: полная скидка, без чек-листа и подсказок", () => {
    render(<WelcomeOfferBanner offer={make([true, true, true])} onNav={vi.fn()} />);
    expect(screen.getByText(/−30% на первую оплату/)).toBeInTheDocument();
    expect(screen.queryByText(/вырастет/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-steps")).not.toBeInTheDocument();
  });

  it("на странице тарифов: чек-лист есть, кнопки «Выбрать тариф» нет", () => {
    render(<WelcomeOfferBanner offer={make([true, false, false])} onNav={vi.fn()} onTariffsPage />);
    expect(screen.getByRole("button", { name: /Онбординг \+10%/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Выбрать тариф/ })).not.toBeInTheDocument();
  });
});

describe("OfferStepHint", () => {
  it("на онбординге: уже набранный процент, что даст онбординг и диагностика, итог до максимума", () => {
    vi.mocked(useWelcomeOffer).mockReturnValue(make([true, false, false]));
    render(<OfferStepHint step="onboarding" />);
    const hint = screen.getByTestId("offer-step-hint");
    expect(hint).toHaveTextContent("уже −10%");
    expect(hint).toHaveTextContent("ещё −10%");
    expect(hint).toHaveTextContent("за диагностику — ещё −10%");
    expect(hint).toHaveTextContent("до −30%");
  });

  it("на диагностике: что добавит диагностика и итог до максимума", () => {
    vi.mocked(useWelcomeOffer).mockReturnValue(make([true, true, false]));
    render(<OfferStepHint step="diagnostic" />);
    expect(screen.getByTestId("offer-step-hint")).toHaveTextContent("Диагностика добавит к скидке ещё −10%");
    expect(screen.getByTestId("offer-step-hint")).toHaveTextContent("до −30%");
  });

  it("молчит, если оффера нет или этот шаг уже засчитан", () => {
    vi.mocked(useWelcomeOffer).mockReturnValue(null);
    const { rerender } = render(<OfferStepHint step="onboarding" />);
    expect(screen.queryByTestId("offer-step-hint")).not.toBeInTheDocument();
    vi.mocked(useWelcomeOffer).mockReturnValue(make([true, true, true]));
    rerender(<OfferStepHint step="diagnostic" />);
    expect(screen.queryByTestId("offer-step-hint")).not.toBeInTheDocument();
  });
});
