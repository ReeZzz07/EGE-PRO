import { beforeEach, describe, expect, it } from "vitest";
import { captureAttribution, getAttributionForSignup, isMarked, mergeAttribution, readAttribution, touchFromLocation } from "./attribution";

const NOW = new Date("2026-10-05T10:00:00Z");

describe("touchFromLocation", () => {
  it("метки рекламы из адреса: utm_*, yclid; путь без параметров", () => {
    const t = touchFromLocation("?utm_source=yandex&utm_medium=cpc&utm_campaign=k3&utm_content=ad1&utm_term=repetitor&yclid=123", "", "/", "ege-tutor.ru", NOW);
    expect(t).toMatchObject({ utm_source: "yandex", utm_medium: "cpc", utm_campaign: "k3", utm_content: "ad1", utm_term: "repetitor", yclid: "123", landing: "/", at: NOW.toISOString() });
    expect(t.referrer).toBeUndefined();
  });

  it("внешний реферер — только хост; свой хост и www игнорируются", () => {
    expect(touchFromLocation("", "https://www.vk.com/away?to=x", "/tariffs", "ege-tutor.ru", NOW).referrer).toBe("vk.com");
    expect(touchFromLocation("", "https://ege-tutor.ru/blog", "/", "ege-tutor.ru", NOW).referrer).toBeUndefined();
    expect(touchFromLocation("", "https://www.ege-tutor.ru/", "/", "ege-tutor.ru", NOW).referrer).toBeUndefined();
    expect(touchFromLocation("", "не-url", "/", "ege-tutor.ru", NOW).referrer).toBeUndefined();
  });

  it("обрезает длинные значения и чистит управляющие символы", () => {
    const t = touchFromLocation(`?utm_source=${"a".repeat(300)}&utm_campaign=k%07%003`, "", "/", "x.ru", NOW);
    expect(t.utm_source).toHaveLength(120);
    expect(t.utm_campaign).toBe("k3");
  });
});

describe("mergeAttribution / isMarked", () => {
  const direct = { landing: "/", at: "1" };
  const ad = { utm_source: "yandex", landing: "/", at: "2" };
  it("первый заход запоминается и не меняется; last обновляется только размеченным заходом", () => {
    const a1 = mergeAttribution(null, direct);
    expect(a1).toEqual({ first: direct, last: direct });
    const a2 = mergeAttribution(a1, ad);
    expect(a2.first).toEqual(direct);
    expect(a2.last).toEqual(ad);
    const a3 = mergeAttribution(a2, { landing: "/tariffs", at: "3" });
    expect(a3.last).toEqual(ad); // прямой заход после рекламы не затирает рекламный
  });
  it("isMarked: реклама или внешний сайт — да, прямой заход — нет", () => {
    expect(isMarked(ad)).toBe(true);
    expect(isMarked({ referrer: "vk.com" })).toBe(true);
    expect(isMarked(direct)).toBe(false);
  });
});

describe("captureAttribution", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("сохраняет метки при первом заходе и отдаёт их для регистрации; повторный заход без меток last не затирает", () => {
    window.history.replaceState(null, "", "/?utm_source=yandex&utm_campaign=k3&yclid=77");
    captureAttribution();
    expect(readAttribution()?.last).toMatchObject({ utm_source: "yandex", utm_campaign: "k3", yclid: "77" });
    window.history.replaceState(null, "", "/tariffs");
    captureAttribution();
    const a = getAttributionForSignup()!;
    expect(a.first.utm_source).toBe("yandex");
    expect(a.last.utm_campaign).toBe("k3");
  });

  it("без хранилища ничего не падает", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("denied");
    };
    expect(() => captureAttribution()).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
