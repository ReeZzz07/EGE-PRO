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

  it("/renew и /onboarding — адреса из писем (продление тарифа и анкета подготовки)", () => {
    expect(pathToView("/renew")).toEqual({ name: "renew" });
    expect(viewToPath({ name: "renew" })).toBe("/renew");
    expect(pathToView("/onboarding")).toEqual({ name: "onboarding" });
    // внутренняя навигация на онбординг (гость на пути регистрации) адрес НЕ меняет — иначе проверка «вошёл ли»
    // для ссылки из письма срабатывала бы и на обычный гостевой онбординг
    expect(viewToPath({ name: "onboarding" })).toBe("/");
  });

  it("/review — адрес из письма-просьбы об отзыве", () => {
    expect(pathToView("/review")).toEqual({ name: "review" });
    expect(viewToPath({ name: "review" })).toBe("/review");
  });

  it("/contacts — публичная страница контактов", () => {
    expect(pathToView("/contacts")).toEqual({ name: "contacts" });
    expect(viewToPath({ name: "contacts" })).toBe("/contacts");
    expect(viewToPath({ name: "contacts", topic: "task_error", taskId: "math-1" })).toBe("/contacts");
  });

  it("/subjects — адрес из письма «оплата не завершена» (докупка предметов)", () => {
    expect(pathToView("/subjects")).toEqual({ name: "subjects" });
    expect(viewToPath({ name: "subjects" })).toBe("/subjects");
  });

  it("/plan — адрес из письма-напоминания про план после диагностики (plan_nudge)", () => {
    expect(pathToView("/plan")).toEqual({ name: "plan" });
    expect(viewToPath({ name: "plan" })).toBe("/plan");
  });

  it("/diagnostic — адрес из письма-напоминания «пройди диагностику» (рассылка по фильтру); subject не в пути", () => {
    expect(pathToView("/diagnostic")).toEqual({ name: "diagnostic" });
    expect(viewToPath({ name: "diagnostic" })).toBe("/diagnostic");
    // внутренняя навигация с конкретным предметом (клик по карточке на дашборде) — тот же путь,
    // как и у /plan: subject в адресную строку не попадает, восстанавливается через effectivePrimarySubject
    expect(viewToPath({ name: "diagnostic", subject: "math" })).toBe("/diagnostic");
  });

  it("неизвестный путь — null (AppShell выправляет адресную строку на /, не рендерит несуществующую страницу)", () => {
    expect(pathToView("/bank")).toBeNull();
    expect(pathToView("/admin")).toBeNull();
    expect(pathToView("/tariffs/")).toBeNull(); // без нормализации трейлинг-слэша — точное совпадение
    expect(pathToView("/random-garbage")).toBeNull();
  });

  it("/blog и /blog/:slug — база знаний, единственный роут здесь с переменным сегментом пути", () => {
    expect(pathToView("/blog")).toEqual({ name: "blog" });
    expect(pathToView("/blog/ii-repetitor-vs-zhivoi")).toEqual({ name: "blog-article", slug: "ii-repetitor-vs-zhivoi" });
    // percent-encoded сегмент декодируется
    expect(pathToView("/blog/%D1%82%D0%B5%D1%81%D1%82")).toEqual({ name: "blog-article", slug: "тест" });
  });

  it("/blog/ — пустой хвост, /blog/a/b — вложенный путь, битый %-escape — всё null, не мусорный slug", () => {
    expect(pathToView("/blog/")).toBeNull();
    expect(pathToView("/blog/a/b")).toBeNull();
    expect(pathToView("/blog/%zz")).toBeNull();
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
      { name: "mock-exam" },
    ];
    for (const v of internalViews) expect(viewToPath(v)).toBe("/");
  });

  it("blog и blog-article — реальные URL, slug кодируется", () => {
    expect(viewToPath({ name: "blog" })).toBe("/blog");
    expect(viewToPath({ name: "blog-article", slug: "ii-repetitor" })).toBe("/blog/ii-repetitor");
  });
});

describe("pathToView ⇄ viewToPath — согласованность для публичных роутов", () => {
  it("viewToPath(pathToView(p)) возвращает исходный путь для каждого известного публичного роута", () => {
    for (const p of ["/tariffs", "/oferta", "/privacy", "/blog"]) {
      const view = pathToView(p);
      expect(view).not.toBeNull();
      expect(viewToPath(view!)).toBe(p);
    }
  });

  it("то же для /blog/:slug — динамический сегмент отдельно, т.к. не входит в фиксированный список выше", () => {
    const view = pathToView("/blog/some-article");
    expect(view).not.toBeNull();
    expect(viewToPath(view!)).toBe("/blog/some-article");
  });
});
