// Счётчик Яндекс.Метрики, цели и «свой код» из админки (SEO).
//
// Два способа подключения, оба задаются в /admin → SEO → «Яндекс.Метрика»:
//  1. НОМЕР счётчика — сниппет собираем сами (initMetrika). Безопасный путь: из настроек берётся
//     только число, произвольный код на сайт не попадает.
//  2. СВОЙ КОД (customCode) — вставляется на сайт как есть (injectCustomCode): для целей и
//     скриптов, которые админ добавляет сам, без правок исходников. Это выполнение произвольного
//     JS от имени сайта на всех страницах — доступно только админу (RLS на content_blocks), но
//     скомпрометированный админ-аккаунт получил бы XSS на всём сайте.
//
// Вебвизор выключен намеренно: на платформе занимаются школьники, а в адресах части страниц есть
// служебные токены (/verify-email, /reset-password, /payment/return). SPA-переходы (pushState)
// Метрика отслеживает сама, отдельные hit-вызовы не нужны.

const ID_RE = /^\d{5,12}$/;
const CODE_ID_RE = /(?:\bym\(\s*|mc\.yandex\.(?:ru|com)\/(?:metrika\/tag(?:_[a-z]+)?\.js\?id=|watch\/))(\d{5,12})/;

/** Номер счётчика из «голого» номера или из полного кода, скопированного из Метрики.
 *  null — номер не найден. */
export function parseMetrikaId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  return s.match(CODE_ID_RE)?.[1] ?? null;
}

interface MetrikaWindow extends Window {
  ym?: ((...args: unknown[]) => void) & { a?: unknown[]; l?: number };
  dataLayer?: unknown[];
  /** номер счётчика, как только он известен странице (свой сниппет или код из админки) */
  __metrikaInit?: string;
  /** цели, запрошенные до того, как счётчик подключился (настройки грузятся асинхронно) */
  __metrikaQueue?: Array<(id: string) => void>;
  __customCodeApplied?: boolean;
}

const TAG_SRC = "https://mc.yandex.ru/metrika/tag.js";
const MAX_QUEUED = 20;

/** Выполнит fn сразу, если счётчик уже подключён, иначе поставит в очередь (до MAX_QUEUED штук —
 *  если счётчик в админке не настроен, очередь просто не сработает). true — выполнено сразу. */
function whenReady(fn: (id: string) => void): boolean {
  const w = window as MetrikaWindow;
  if (w.__metrikaInit && w.ym) {
    fn(w.__metrikaInit);
    return true;
  }
  const q = (w.__metrikaQueue = w.__metrikaQueue ?? []);
  if (q.length < MAX_QUEUED) q.push(fn);
  return false;
}

function flushQueue(w: MetrikaWindow): void {
  const q = w.__metrikaQueue ?? [];
  w.__metrikaQueue = [];
  if (w.__metrikaInit) q.forEach((fn) => fn(w.__metrikaInit as string));
}

/** Подключает счётчик на странице. Идемпотентно: повторный вызов с тем же номером ничего не делает. */
export function initMetrika(id: string): void {
  if (!ID_RE.test(id)) return;
  const w = window as MetrikaWindow;
  if (w.__metrikaInit === id) return;
  w.__metrikaInit = id;

  w.dataLayer = w.dataLayer ?? [];
  if (!w.ym) {
    // Очередь-заглушка, как в официальном сниппете: вызовы до загрузки tag.js копятся в ym.a
    // (именно объект arguments, его ждёт tag.js) и выполняются, когда скрипт подгрузится.
    const stub = function () {
      // eslint-disable-next-line prefer-rest-params
      (stub.a = stub.a ?? []).push(arguments);
    } as NonNullable<MetrikaWindow["ym"]>;
    stub.l = Date.now();
    w.ym = stub;
  }

  if (!Array.from(document.scripts).some((s) => s.src === TAG_SRC)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = TAG_SRC;
    document.head.appendChild(script);
  }

  w.ym(Number(id), "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true, ecommerce: "dataLayer" });
  flushQueue(w);
}

// ─────────────────────── цели ───────────────────────

/** Идентификаторы целей-событий (тип цели в Метрике — «JavaScript-событие»). Список и смысл каждой —
 *  в docs/yandex-direct-plan.html, раздел 2.1. */
export type GoalName =
  | "signup"
  | "first_ai_use"
  | "checkout_start"
  | "purchase"
  | "task_opened"
  | "ai_limit_reached"
  | "exam_mode_start"
  | "essay_check_used";

/** Достигнута цель. Если счётчик не подключён (не настроен в админке / ещё грузится) — цель ждёт в
 *  очереди и уходит после init; ничего не отправляется, пока счётчика нет вовсе.
 *  onSent — вызывается, когда Метрика приняла событие (или через 1 с, или сразу, если счётчика нет):
 *  нужен перед уходом со страницы (редирект на оплату), чтобы событие не потерялось, но действие
 *  пользователя при этом не зависло. */
export function reachGoal(goal: GoalName, params?: Record<string, unknown>, onSent?: () => void): void {
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      onSent?.();
    }
  };
  const ranNow = whenReady((id) => {
    (window as MetrikaWindow).ym!(Number(id), "reachGoal", goal, params ?? {}, finish);
    if (onSent) setTimeout(finish, 1000);
  });
  if (!ranNow) finish();
}

const onceMemory = new Set<string>();

/** true — этот ключ встречается впервые (и теперь запомнен). scope: forever — в этом браузере
 *  навсегда (localStorage), session — до закрытия вкладки. Если хранилище недоступно — в памяти. */
function firstTime(key: string, scope: "forever" | "session"): boolean {
  const k = `metrika_goal:${key}`;
  try {
    const storage = scope === "session" ? sessionStorage : localStorage;
    if (storage.getItem(k)) return false;
    storage.setItem(k, "1");
    return true;
  } catch {
    if (onceMemory.has(k)) return false;
    onceMemory.add(k);
    return true;
  }
}

/** Цель не чаще одного раза на ключ: «первое обращение к ИИ» — один раз на браузер, «открыл
 *  задание» — раз за сессию и т. п., чтобы активный пользователь не раздувал счётчик достижений. */
export function reachGoalOnce(key: string, goal: GoalName, scope: "forever" | "session" = "forever", params?: Record<string, unknown>): void {
  if (firstTime(key, scope)) reachGoal(goal, params);
}

/** Успешная оплата: цель «purchase» с суммой + электронная коммерция (dataLayer, ecommerce:
 *  "dataLayer" в init). Один раз на платёж — иначе обновление страницы возврата считалось бы
 *  повторной покупкой. */
export function trackPurchase(p: { paymentId: string; amountRub?: number; tariffId?: string }): void {
  if (!firstTime(`purchase:${p.paymentId}`, "forever")) return;
  reachGoal("purchase", p.amountRub ? { order_price: p.amountRub, currency: "RUB" } : undefined);
  if (!p.amountRub) return;
  const amountRub = p.amountRub;
  whenReady(() => {
    const w = window as MetrikaWindow;
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({
      ecommerce: {
        currencyCode: "RUB",
        purchase: {
          actionField: { id: p.paymentId, revenue: amountRub },
          products: [{ id: p.tariffId ?? "tariff", name: p.tariffId ?? "tariff", price: amountRub, quantity: 1 }],
        },
      },
    });
  });
}

// ─────────────────────── свой код из админки ───────────────────────

/** Вставляет код из админки на страницу как есть: <script> пересоздаются (через innerHTML скрипты
 *  не выполняются), остальное — например <noscript>-пиксель — добавляется в конец <body>. Один раз
 *  за загрузку страницы. Если в коде есть номер счётчика (сниппет Метрики) и свой счётчик по номеру
 *  не подключён — этот номер используется для целей из приложения (reachGoal). */
export function injectCustomCode(html: string): void {
  const code = html.trim();
  const w = window as MetrikaWindow;
  if (!code || w.__customCodeApplied) return;
  w.__customCodeApplied = true;

  const tpl = document.createElement("template");
  tpl.innerHTML = code;
  for (const node of Array.from(tpl.content.childNodes)) {
    if (node instanceof HTMLScriptElement) {
      const s = document.createElement("script");
      for (const a of Array.from(node.attributes)) s.setAttribute(a.name, a.value);
      s.text = node.text;
      document.head.appendChild(s);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      document.body.appendChild(document.importNode(node, true));
    }
  }

  const id = parseMetrikaId(code);
  if (id && !w.__metrikaInit && w.ym) {
    w.__metrikaInit = id;
    flushQueue(w);
  }
}
