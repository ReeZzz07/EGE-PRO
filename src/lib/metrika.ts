// Счётчик Яндекс.Метрики. В админке (SEO) хранится только НОМЕР счётчика — сниппет собираем сами,
// а не вставляем произвольный HTML/JS из настроек: так скрипт от имени сайта не может оказаться
// чем-то, кроме счётчика (скомпрометированный админ-аккаунт иначе получил бы постоянный
// XSS на всём сайте). Админ может вставить и весь код, который показывает Метрика, — из него
// берётся только номер (см. parseMetrikaId).
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
  __metrikaInit?: string;
}

const TAG_SRC = "https://mc.yandex.ru/metrika/tag.js";

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
}
