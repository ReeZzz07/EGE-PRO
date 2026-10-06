// Формулы в ответах ИИ-репетитора: скобочный LaTeX и разметка со знаком доллара должны отрисовываться
// формулами (KaTeX), а не показываться сырым текстом (жалоба 06.10.2026: «$f(x) = a \cdot \cos(b\pi x + c) + d$»).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TutorText } from "./ui";

const BS = String.fromCharCode(92);
const katexCount = (c: HTMLElement) => c.querySelectorAll(".katex").length;

describe("TutorText: формулы", () => {
  it("настоящий ответ из жалобы: формулы в долларах рисуются KaTeX, сырых долларов и «\\cdot» на экране нет", () => {
    const text = [
      `Нам дана функция вида $f(x) = a ${BS}cdot ${BS}cos(b${BS}pi x + c) + d$.`,
      "",
      "Шаг 2. Находим среднюю линию.",
      "",
      `Давай её вычислим: $${BS}frac{4 + (-2)}{2} = ${BS}frac{2}{2} = 1$.`,
      "",
      "Значит, $d = 1$ и $|a| = 3$.",
    ].join("\n");
    const { container } = render(<TutorText text={text} />);
    expect(katexCount(container)).toBe(4);
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain(`${BS}cdot`);
    expect(container.textContent).not.toContain(`${BS}frac`);
  });

  it("блочная формула в двойных долларах, в том числе на нескольких строках, — отдельным блоком", () => {
    const text = `Получаем:\n$$\n${BS}cos(x) = 0{,}6\n$$\nДальше сам(а).`;
    const { container } = render(<TutorText text={text} />);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.textContent).not.toContain("$");
    expect(container.textContent).toContain("Дальше сам(а).");
  });

  it("прежняя скобочная разметка работает как раньше", () => {
    const text = `Внутри фразы ${BS}(x^2${BS}) и отдельно:\n${BS}[${BS}sqrt{9} = 3${BS}]`;
    const { container } = render(<TutorText text={text} />);
    expect(katexCount(container)).toBe(2);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("обычные доллары в тексте не принимаются за формулу: «5 $ и 6 $», одиночный знак, цена с пробелами", () => {
    const { container } = render(<TutorText text={"Билет стоил 5 $ и ещё 6 $ сверху. Просто знак $ в конце"} />);
    expect(katexCount(container)).toBe(0);
    expect(container.textContent).toContain("5 $ и ещё 6 $");
  });

  it("битая формула не ломает ответ: показывается исходный текст", () => {
    const { container } = render(<TutorText text={`Смотри: $${BS}frac{1}{$ и дальше текст`} />);
    expect(container.textContent).toContain("и дальше текст");
  });
});
