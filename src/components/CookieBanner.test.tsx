// Баннер-уведомление о cookie и Метрике: показывается, пока пользователь не нажал «Понятно»; после
// этого — не показывается в этом браузере. Никакого выбора «принять/отклонить» здесь нет.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CookieBanner from "./CookieBanner";
import { acknowledgeNotice, isNoticeAcknowledged } from "../lib/cookieNotice";

describe("CookieBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("первый визит — баннер виден, упоминает cookie и Яндекс.Метрику, есть кнопка «Понятно»", () => {
    render(<CookieBanner onNav={vi.fn()} />);
    const banner = screen.getByRole("region", { name: /cookie/i });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/cookie/);
    expect(banner).toHaveTextContent(/Яндекс.Метрика/);
    expect(screen.getByRole("button", { name: "Понятно" })).toBeInTheDocument();
  });

  it("это уведомление, а не запрос разрешения — кнопок отказа/выбора нет", () => {
    render(<CookieBanner onNav={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /принять|отклонить|только необходимые/i })).not.toBeInTheDocument();
  });

  it("«Понятно» — запоминает подтверждение и убирает баннер", () => {
    render(<CookieBanner onNav={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Понятно" }));
    expect(isNoticeAcknowledged()).toBe(true);
    expect(screen.queryByRole("region", { name: /cookie/i })).not.toBeInTheDocument();
  });

  it("подтверждение уже было раньше — баннер не показывается", () => {
    acknowledgeNotice();
    render(<CookieBanner onNav={vi.fn()} />);
    expect(screen.queryByRole("region", { name: /cookie/i })).not.toBeInTheDocument();
  });

  it("ссылка на политику конфиденциальности ведёт на экран политики", () => {
    const onNav = vi.fn();
    render(<CookieBanner onNav={onNav} />);
    fireEvent.click(screen.getByRole("button", { name: "Политика конфиденциальности" }));
    expect(onNav).toHaveBeenCalledWith({ name: "legal", doc: "privacy" });
  });
});
