import { describe, expect, it } from "vitest";
import { prepareArticleHtml } from "./articleToc";

describe("prepareArticleHtml", () => {
  it("ставит id на h2/h3 и собирает toc", () => {
    const { html, toc } = prepareArticleHtml("<h2>С чего начать</h2><p>текст</p><h3>Шаг один</h3>");
    expect(toc).toEqual([
      { id: "s-chego-nachat", text: "С чего начать", level: 2 },
      { id: "shag-odin", text: "Шаг один", level: 3 },
    ]);
    expect(html).toContain('id="s-chego-nachat"');
    expect(html).toContain('id="shag-odin"');
  });

  it("режет опасный html до sanitize", () => {
    const { html } = prepareArticleHtml('<h2>Ок</h2><script>alert(1)</script>');
    expect(html).not.toContain("script");
    expect(html).toContain("Ок");
  });
});
