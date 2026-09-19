// Счётчик Яндекс.Метрики: из админки приходит номер ИЛИ весь код, скопированный из Метрики —
// parseMetrikaId вытаскивает только номер (сам скрипт из настроек на сайт не попадает), а
// initMetrika подключает счётчик собственным сниппетом.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initMetrika, injectCustomCode, parseMetrikaId, reachGoal, reachGoalOnce, trackPurchase } from "./metrika";

// Реальный формат кода, который Метрика показывает при создании счётчика.
const NEW_SNIPPET = `<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
    (window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=98765432", "ym");

    ym(98765432, "init", { clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true });
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/98765432" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`;

const OLD_SNIPPET = `(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(12345678, "init", { clickmap:true });`;

describe("parseMetrikaId", () => {
  it("голый номер — как есть, пробелы по краям срезаются", () => {
    expect(parseMetrikaId("98765432")).toBe("98765432");
    expect(parseMetrikaId("  98765432\n")).toBe("98765432");
  });

  it("полный код счётчика (новый формат, tag.js?id=) — номер из него", () => {
    expect(parseMetrikaId(NEW_SNIPPET)).toBe("98765432");
  });

  it("старый формат (только ym(ID, \"init\")) — номер из вызова init", () => {
    expect(parseMetrikaId(OLD_SNIPPET)).toBe("12345678");
  });

  it("только noscript-картинка — номер из /watch/ID", () => {
    expect(parseMetrikaId('<img src="https://mc.yandex.ru/watch/55555555">')).toBe("55555555");
  });

  it("не номер и не код — null (например, случайный текст, буквы, слишком короткое число)", () => {
    expect(parseMetrikaId("")).toBeNull();
    expect(parseMetrikaId("abc")).toBeNull();
    expect(parseMetrikaId("1234")).toBeNull();
    expect(parseMetrikaId("<script>alert(1)</script>")).toBeNull();
  });
});

describe("initMetrika", () => {
  beforeEach(() => {
    document.head.querySelectorAll('script[src*="mc.yandex.ru"]').forEach((s) => s.remove());
    const w = window as unknown as Record<string, unknown>;
    delete w.ym;
    delete w.dataLayer;
    delete w.__metrikaInit;
  });

  it("подключает tag.js и ставит в очередь вызов init с номером счётчика", () => {
    initMetrika("98765432");
    expect(document.head.querySelectorAll('script[src="https://mc.yandex.ru/metrika/tag.js"]')).toHaveLength(1);
    const ym = (window as unknown as { ym: { a: ArrayLike<unknown>[] } }).ym;
    const call = Array.from(ym.a[0]);
    expect(call[0]).toBe(98765432);
    expect(call[1]).toBe("init");
    expect(call[2]).toMatchObject({ clickmap: true, trackLinks: true, accurateTrackBounce: true, ecommerce: "dataLayer" });
  });

  it("вебвизор не включается", () => {
    initMetrika("98765432");
    const ym = (window as unknown as { ym: { a: ArrayLike<unknown>[] } }).ym;
    expect(Array.from(ym.a[0])[2]).not.toHaveProperty("webvisor");
  });

  it("создаёт dataLayer для электронной коммерции", () => {
    initMetrika("98765432");
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer).toEqual([]);
  });

  it("повторный вызов с тем же номером — второго скрипта и второго init нет", () => {
    initMetrika("98765432");
    initMetrika("98765432");
    expect(document.head.querySelectorAll('script[src*="mc.yandex.ru"]')).toHaveLength(1);
    expect((window as unknown as { ym: { a: unknown[] } }).ym.a).toHaveLength(1);
  });

  it("некорректный номер (пустой, с буквами) — ничего не подключается", () => {
    initMetrika("");
    initMetrika("12ab");
    expect(document.head.querySelectorAll('script[src*="mc.yandex.ru"]')).toHaveLength(0);
    expect((window as unknown as { ym?: unknown }).ym).toBeUndefined();
  });
});

// ─────────────────────── цели и свой код ───────────────────────
type YmStub = { a: ArrayLike<unknown>[] };
const ymCalls = () => Array.from((window as unknown as { ym?: YmStub }).ym?.a ?? []).map((c) => Array.from(c));
const goalCalls = () => ymCalls().filter((c) => c[1] === "reachGoal");
const dataLayer = () => (window as unknown as { dataLayer: unknown[] }).dataLayer;

function resetMetrikaWindow() {
  document.head.querySelectorAll("script").forEach((s) => s.remove());
  document.body.innerHTML = "";
  const w = window as unknown as Record<string, unknown>;
  for (const k of ["ym", "dataLayer", "__metrikaInit", "__metrikaQueue", "__customCodeApplied"]) delete w[k];
  localStorage.clear();
  sessionStorage.clear();
}

describe("reachGoal", () => {
  beforeEach(resetMetrikaWindow);
  afterEach(() => vi.useRealTimers());

  it("счётчик подключён — уходит reachGoal с номером счётчика, названием цели и параметрами", () => {
    initMetrika("98765432");
    reachGoal("checkout_start", { tariff: "attestat", price: 1990 });
    expect(goalCalls()[0].slice(0, 4)).toEqual([98765432, "reachGoal", "checkout_start", { tariff: "attestat", price: 1990 }]);
  });

  it("цель до подключения счётчика ждёт в очереди и уходит после init", () => {
    reachGoal("signup");
    expect(ymCalls()).toHaveLength(0);
    initMetrika("98765432");
    expect(ymCalls().map((c) => c[1])).toEqual(["init", "reachGoal"]);
    expect(ymCalls()[1][2]).toBe("signup");
  });

  it("счётчика нет вовсе — onSent вызывается сразу, действие пользователя не задерживается", () => {
    const onSent = vi.fn();
    reachGoal("checkout_start", {}, onSent);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("счётчик есть, Метрика не ответила — onSent срабатывает по таймауту в 1 с, ровно один раз", () => {
    vi.useFakeTimers();
    initMetrika("98765432");
    const onSent = vi.fn();
    reachGoal("checkout_start", {}, onSent);
    expect(onSent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onSent).toHaveBeenCalledTimes(1);
    // Метрика ответила позже таймаута — повторного вызова нет
    (goalCalls()[0][4] as () => void)();
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("Метрика приняла событие быстрее таймаута — onSent вызывается её колбэком", () => {
    initMetrika("98765432");
    const onSent = vi.fn();
    reachGoal("checkout_start", {}, onSent);
    (goalCalls()[0][4] as () => void)();
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("очередь ограничена — без счётчика она не растёт бесконечно", () => {
    for (let i = 0; i < 100; i++) reachGoal("task_opened");
    initMetrika("98765432");
    expect(goalCalls()).toHaveLength(20);
  });
});

describe("reachGoalOnce", () => {
  beforeEach(resetMetrikaWindow);

  it("повторный вызов с тем же ключом не шлёт цель второй раз", () => {
    initMetrika("98765432");
    reachGoalOnce("first_ai_use", "first_ai_use");
    reachGoalOnce("first_ai_use", "first_ai_use");
    expect(goalCalls()).toHaveLength(1);
  });

  it("разные ключи — независимы", () => {
    initMetrika("98765432");
    reachGoalOnce("a", "task_opened");
    reachGoalOnce("b", "task_opened");
    expect(goalCalls()).toHaveLength(2);
  });

  it("scope session — хранится в sessionStorage, forever — в localStorage", () => {
    initMetrika("98765432");
    reachGoalOnce("s", "task_opened", "session");
    reachGoalOnce("f", "first_ai_use", "forever");
    expect(sessionStorage.getItem("metrika_goal:s")).toBe("1");
    expect(localStorage.getItem("metrika_goal:s")).toBeNull();
    expect(localStorage.getItem("metrika_goal:f")).toBe("1");
  });
});

describe("trackPurchase", () => {
  beforeEach(resetMetrikaWindow);

  it("цель purchase с суммой и валютой + покупка в dataLayer для электронной коммерции", () => {
    initMetrika("98765432");
    trackPurchase({ paymentId: "pay-1", amountRub: 1990, tariffId: "attestat" });
    expect(goalCalls()[0][2]).toBe("purchase");
    expect(goalCalls()[0][3]).toEqual({ order_price: 1990, currency: "RUB" });
    expect(dataLayer()).toEqual([
      {
        ecommerce: {
          currencyCode: "RUB",
          purchase: {
            actionField: { id: "pay-1", revenue: 1990 },
            products: [{ id: "attestat", name: "attestat", price: 1990, quantity: 1 }],
          },
        },
      },
    ]);
  });

  it("обновление страницы возврата — повторная покупка не считается", () => {
    initMetrika("98765432");
    trackPurchase({ paymentId: "pay-1", amountRub: 1990 });
    trackPurchase({ paymentId: "pay-1", amountRub: 1990 });
    expect(goalCalls()).toHaveLength(1);
    expect(dataLayer()).toHaveLength(1);
  });

  it("другой платёж — считается отдельно", () => {
    initMetrika("98765432");
    trackPurchase({ paymentId: "pay-1", amountRub: 1990 });
    trackPurchase({ paymentId: "pay-2", amountRub: 990 });
    expect(goalCalls()).toHaveLength(2);
  });

  it("суммы нет (ответ сервера без неё) — цель уходит без выручки, в dataLayer ничего", () => {
    initMetrika("98765432");
    trackPurchase({ paymentId: "pay-1" });
    expect(goalCalls()[0][3]).toEqual({});
    expect(dataLayer()).toEqual([]);
  });
});

describe("injectCustomCode", () => {
  beforeEach(resetMetrikaWindow);

  it("<script> пересоздаётся с атрибутами и текстом (через innerHTML скрипты не выполнились бы)", () => {
    injectCustomCode('<script data-x="1">window.__t = 1;</script>');
    const s = document.head.querySelector('script[data-x="1"]') as HTMLScriptElement;
    expect(s).toBeTruthy();
    expect(s.text).toBe("window.__t = 1;");
  });

  it("внешний скрипт (src) сохраняет адрес и async", () => {
    injectCustomCode('<script async src="https://example.com/a.js"></script>');
    expect(document.head.querySelector('script[src="https://example.com/a.js"]')!.hasAttribute('async')).toBe(true);
  });

  it("не-скрипты (например <noscript> с пикселем) попадают в конец <body>", () => {
    injectCustomCode("<noscript><div>pixel</div></noscript>");
    expect(document.body.querySelector("noscript")).toBeTruthy();
  });

  it("пустой ввод и комментарии игнорируются без ошибок", () => {
    expect(() => injectCustomCode("   ")).not.toThrow();
    expect(() => injectCustomCode("<!-- только комментарий -->")).not.toThrow();
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("применяется один раз за загрузку страницы", () => {
    injectCustomCode("<script>1</script>");
    injectCustomCode("<script>2</script>");
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });

  it("свой сниппет Метрики с номером (счётчик по номеру не подключён) — номер запоминается для целей приложения", () => {
    (window as unknown as { ym: unknown }).ym = function () {};
    injectCustomCode('<script>/* ym(55555555, "init", {}) */</script>');
    expect((window as unknown as { __metrikaInit?: string }).__metrikaInit).toBe("55555555");
  });

  it("счётчик по номеру уже подключён — номер из своего кода его не подменяет", () => {
    initMetrika("98765432");
    injectCustomCode('<script>/* ym(55555555, "init", {}) */</script>');
    expect((window as unknown as { __metrikaInit?: string }).__metrikaInit).toBe("98765432");
  });
});
