// Подтверждение «Понятно» на баннере cookie: хранится в localStorage, с запасом в памяти.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeNotice, isNoticeAcknowledged } from "./cookieNotice";

describe("cookieNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("не подтверждено — false; после acknowledgeNotice — true и сохранено в localStorage", () => {
    expect(isNoticeAcknowledged()).toBe(false);
    acknowledgeNotice();
    expect(localStorage.getItem("cookie_notice_ack")).toBe("1");
    expect(isNoticeAcknowledged()).toBe(true);
  });

  it("подтверждение из прошлой сессии (значение уже в localStorage) — учитывается", () => {
    localStorage.setItem("cookie_notice_ack", "1");
    expect(isNoticeAcknowledged()).toBe(true);
  });

  it("localStorage недоступен — подтверждение держится в памяти, баннер можно закрыть", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => acknowledgeNotice()).not.toThrow();
    expect(isNoticeAcknowledged()).toBe(true);
    set.mockRestore();
    get.mockRestore();
  });
});
