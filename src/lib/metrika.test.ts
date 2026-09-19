// Счётчик Яндекс.Метрики: из админки приходит номер ИЛИ весь код, скопированный из Метрики —
// parseMetrikaId вытаскивает только номер (сам скрипт из настроек на сайт не попадает), а
// initMetrika подключает счётчик собственным сниппетом.
import { beforeEach, describe, expect, it } from "vitest";
import { initMetrika, parseMetrikaId } from "./metrika";

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
