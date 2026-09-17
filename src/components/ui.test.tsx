// TutorText — рендер ответов ИИ-репетитора (чат + подсказки в SolveView, см. SolveView.test.tsx
// не существует отдельно, но эта разметка теперь используется и там). Модель время от времени
// отвечает markdown-подобным текстом ("###" заголовки, "-"/"•" списки, **bold**) — до этого он
// показывался как сырой текст с видимыми решётками/звёздочками, что и было жалобой пользователя
// на нечитаемость подсказок.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TutorText } from "./ui";

describe("TutorText", () => {
  it("обычный многострочный текст — каждая строка своим абзацем", () => {
    render(<TutorText text={"Первая строка.\nВторая строка."} />);
    expect(screen.getByText("Первая строка.")).toBeInTheDocument();
    expect(screen.getByText("Вторая строка.")).toBeInTheDocument();
  });

  it("**bold** — рендерится как <strong>, без звёздочек в тексте", () => {
    render(<TutorText text={"Обычный текст с **выделенным** словом."} />);
    const strong = screen.getByText("выделенным");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("markdown-заголовок (### ...) — рендерится жирным без решёток", () => {
    render(<TutorText text={"### Короткий вопрос для самопроверки"} />);
    expect(screen.getByText("Короткий вопрос для самопроверки")).toBeInTheDocument();
    expect(screen.queryByText(/#/)).not.toBeInTheDocument();
  });

  it("список через «- » — распознаётся как маркированный пункт, дефис не остаётся в тексте", () => {
    const { container } = render(<TutorText text={"- Первый пункт списка"} />);
    expect(screen.getByText("Первый пункт списка")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^-/);
  });

  it("список через «• » — тоже распознаётся (обратная совместимость)", () => {
    render(<TutorText text={"• Пункт через точку"} />);
    expect(screen.getByText("Пункт через точку")).toBeInTheDocument();
  });

  it("номер пункта задания («1) ...») НЕ считается маркером списка — это цифры условия, не форматирование", () => {
    const { container } = render(<TutorText text={"1) Экономика не подвержена влиянию."} />);
    // текст остаётся с "1)" на месте, не превращается в список без номера
    expect(container.textContent).toContain("1) Экономика не подвержена влиянию.");
  });

  it("пустые строки между абзацами не создают пустых параграфов", () => {
    const { container } = render(<TutorText text={"Абзац один.\n\n\nАбзац два."} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
  });

  // На математике/физике/химии модель пишет формулы в LaTeX (\[ ... \] / \( ... \)), а не голым
  // текстом — раньше это шло в TutorText как есть, сырыми "\cdot"/"\frac{}{}" и обратными слэшами
  // прямо в тексте ответа (см. жалобу пользователя на "лишние символы" в формулах).
  it("формула \\( ... \\) внутри фразы — рендерится через KaTeX, сырые скобки/слэши не видны", () => {
    const { container } = render(<TutorText text={"Найди коэффициент \\( a \\) в этой формуле."} />);
    expect(container.textContent).not.toContain("\\(");
    expect(container.textContent).not.toContain("\\)");
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("формула \\[ ... \\] на отдельной строке — блочный (displayMode) рендер через KaTeX", () => {
    const { container } = render(<TutorText text={"\\[ f(x) = a \\cdot \\cos(b\\pi x + c) + d \\]"} />);
    expect(container.textContent).not.toContain("\\[");
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("невалидный LaTeX — не ломает рендер, показывает исходный текст как запасной вариант", () => {
    const { container } = render(<TutorText text={"Смотри: \\( \\frac{1 \\) — тут не сойдётся."} />);
    expect(container.textContent).toContain("\\frac{1");
  });

  // Живой баг (см. жалобу пользователя со скриншотом): модель часто пишет блочную формулу как
  // "\[\nформула\n\]" — открывающий и закрывающий маркер на СВОИХ строках. TutorText раньше режет
  // весь текст на строки ДО поиска формул, поэтому такой блок никогда не совпадал целиком — маркеры
  // \[ и \] оставались видны как сырой текст на отдельных строках.
  it("блочная формула \\[ ... \\], разбитая на несколько строк (маркеры на своих строках) — рендерится целиком", () => {
    const { container } = render(<TutorText text={"Шаг 4:\n\\[\n\\cos(x) = \\pm 0,6\n\\]\nШаг 5: определим знак."} />);
    expect(container.textContent).not.toContain("\\[");
    expect(container.textContent).not.toContain("\\]");
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(screen.getByText("Шаг 4:")).toBeInTheDocument();
    expect(screen.getByText("Шаг 5: определим знак.")).toBeInTheDocument();
  });
});
