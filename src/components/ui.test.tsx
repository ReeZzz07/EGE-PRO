// TutorText — рендер ответов ИИ-репетитора (чат + подсказки в SolveView, см. SolveView.test.tsx
// не существует отдельно, но эта разметка теперь используется и там). Модель время от времени
// отвечает markdown-подобным текстом ("###" заголовки, "-"/"•" списки, **bold**) — до этого он
// показывался как сырой текст с видимыми решётками/звёздочками, что и было жалобой пользователя
// на нечитаемость подсказок.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskStatement, TutorText, statementPreview } from "./ui";

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

  // Живая проверка по просьбе пользователя ("проверь физику и химию, там тоже много формул") —
  // реальные ответы модели (записаны как есть): chem-8226, термохимическое уравнение, с \text{} для
  // формул веществ и кириллицей внутри \text{}; fiz-25069, модуль перемещения, со степенью, \cdot и
  // модулем |...|. Рендерер не завязан на предмет, но эти команды в предыдущих тестах не встречались.
  it("формулы по химии (\\text{}, кириллица внутри \\text{}, нижние индексы) — рендерятся без сырого LaTeX", () => {
    const { container } = render(
      <TutorText text={"\\[ \\text{H}^+ (р-р) + \\text{OH}^- (р-р) = \\text{H}_2\\text{O} (ж) + 56 \\, \\text{кДж} \\]"} />
    );
    expect(container.textContent).not.toMatch(/\\text|\\frac|\\\[|\\\]/);
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("формулы по физике (степень, \\cdot, модуль |...|, \\Delta) — рендерятся без сырого LaTeX", () => {
    const { container } = render(<TutorText text={"\\[ x(6) = -1 + 6 \\cdot 6 - 6^2 \\]\n\\[ |\\Delta x| = |0| \\]"} />);
    expect(container.textContent).not.toMatch(/\\cdot|\\Delta|\^2|\\\[/);
    expect(container.querySelectorAll(".katex-display").length).toBe(2);
  });
});

describe("TaskStatement", () => {
  it("маркер [ИЗОБРАЖЕНИЕ N] заменяется формулой на своём месте, сырой маркер не виден", () => {
    const { container } = render(
      <TaskStatement task={{ statement: ["Найдите корень уравнения [ИЗОБРАЖЕНИЕ 1] Если корней несколько…"], images: ["/f/1.svg"] }} />
    );
    expect(container.textContent).not.toMatch(/ИЗОБРАЖЕНИЕ/);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/f/1.svg");
    expect(img?.getAttribute("alt")).toBe("формула");
  });

  it("картинка без маркера в тексте показывается отдельным блоком", () => {
    const { container } = render(<TaskStatement task={{ statement: ["Смотри рисунок."], images: ["/f/plot.png"] }} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("statementPreview", () => {
  it("вырезает служебные маркеры картинок из превью", () => {
    expect(statementPreview("Найдите корень  [ИЗОБРАЖЕНИЕ 1]  Если корней несколько")).toBe("Найдите корень … Если корней несколько");
    expect(statementPreview("[ИЗОБРАЖЕНИЕ 1] [ИЗОБРАЖЕНИЕ 2] равно")).toBe("… равно");
    expect(statementPreview(undefined)).toBe("");
  });
});

describe("MediaItem: заглушка на время загрузки", () => {
  it("пока картинка грузится — виден индикатор, после загрузки — сама картинка", () => {
    const { container } = render(<TaskStatement task={{ statement: ["Найдите [ИЗОБРАЖЕНИЕ 1] значение"], images: ["/f/1.svg"] }} />);
    expect(screen.getByLabelText("Изображение загружается")).toBeInTheDocument();
    fireEvent.load(container.querySelector("img")!);
    expect(screen.queryByLabelText("Изображение загружается")).not.toBeInTheDocument();
  });

  it("ошибка загрузки — кнопка «повторить», после клика запрос уходит заново", () => {
    const { container } = render(<TaskStatement task={{ statement: ["Смотри [ИЗОБРАЖЕНИЕ 1]"], images: ["/f/1.svg"] }} />);
    fireEvent.error(container.querySelector("img")!);
    fireEvent.click(screen.getByRole("button", { name: /повторить/ }));
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/f/1.svg?retry=1");
    expect(screen.getByLabelText("Изображение загружается")).toBeInTheDocument();
  });
});
