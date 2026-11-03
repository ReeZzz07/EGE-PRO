import { describe, expect, it } from "vitest";
import { faqPageLd } from "./useJsonLd";

describe("faqPageLd", () => {
  it("пустой список — null", () => {
    expect(faqPageLd([])).toBeNull();
  });

  it("собирает FAQPage из видимых Q&A", () => {
    const ld = faqPageLd([{ q: "Вопрос?", a: "Ответ." }]);
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Вопрос?", acceptedAnswer: { "@type": "Answer", text: "Ответ." } }],
    });
  });
});
