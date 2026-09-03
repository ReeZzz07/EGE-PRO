// Мост между View и адресной строкой (см. routes.ts) — единственные два публичных маршрута с
// настоящим URL сейчас: /tariffs и /oferta·/privacy (см. AdminSeoSettings.tsx/sitemap.xml). Тут
// легко незаметно сломать симметрию pathToView ⇄ viewToPath при добавлении нового публичного
// роута — тесты держат оба направления согласованными.
import { describe, expect, it } from "vitest";
import { pathToView, viewToPath } from "./routes";
import type { View } from "../components/Header";

describe("pathToView", () => {
  it("/tariffs, /oferta, /privacy, / — известные публичные роуты", () => {
    expect(pathToView("/tariffs")).toEqual({ name: "tariffs" });
    expect(pathToView("/oferta")).toEqual({ name: "legal", doc: "offer" });
    expect(pathToView("/privacy")).toEqual({ name: "legal", doc: "privacy" });
    expect(pathToView("/")).toEqual({ name: "landing" });
  });

  it("неизвестный путь — null (AppShell выправляет адресную строку на /, не рендерит несуществующую страницу)", () => {
    expect(pathToView("/bank")).toBeNull();
    expect(pathToView("/admin")).toBeNull();
    expect(pathToView("/tariffs/")).toBeNull(); // без нормализации трейлинг-слэша — точное совпадение
    expect(pathToView("/random-garbage")).toBeNull();
  });
});

describe("viewToPath", () => {
  it("tariffs и legal — реальные URL", () => {
    expect(viewToPath({ name: "tariffs" })).toBe("/tariffs");
    expect(viewToPath({ name: "legal", doc: "offer" })).toBe("/oferta");
    expect(viewToPath({ name: "legal", doc: "privacy" })).toBe("/privacy");
  });

  it("всё остальное (внутренние экраны приложения) — адресная строка сворачивается на /", () => {
    const internalViews: View[] = [
      { name: "home" },
      { name: "bank", subject: "math" },
      { name: "task", id: "t1" },
      { name: "admin" },
      { name: "plan", subject: "fiz" },
      { name: "mock-exam" },
    ];
    for (const v of internalViews) expect(viewToPath(v)).toBe("/");
  });
});

describe("pathToView ⇄ viewToPath — согласованность для публичных роутов", () => {
  it("viewToPath(pathToView(p)) возвращает исходный путь для каждого известного публичного роута", () => {
    for (const p of ["/tariffs", "/oferta", "/privacy"]) {
      const view = pathToView(p);
      expect(view).not.toBeNull();
      expect(viewToPath(view!)).toBe(p);
    }
  });
});
