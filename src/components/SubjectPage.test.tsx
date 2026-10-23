// Посадочная страница предмета для людей: заголовок со склонением, разделы и темы с сервера, шаги, вопросы, кнопки.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SubjectPage from "./SubjectPage";
import * as lib from "../lib/subjectPage";

vi.mock("../lib/useDocumentHead", () => ({ useDocumentHead: vi.fn() }));
vi.mock("../lib/content", async (orig) => ({ ...(await orig<typeof import("../lib/content")>()), loadLandingContent: vi.fn().mockRejectedValue(new Error("нет сети")) }));
vi.mock("../lib/subjectPage", async (orig) => ({ ...(await orig<typeof import("../lib/subjectPage")>()), loadSubjectContent: vi.fn() }));

beforeEach(() => {
  vi.mocked(lib.loadSubjectContent).mockResolvedValue({ total: 11252, sections: [{ name: "Зоология", n: 1225 }], topics: [{ name: "Клетка", n: 300 }] });
});

describe("SubjectPage", () => {
  it("h1 «по биологии», число заданий и разделы из банка, вопросы со склонением, ссылки на другие предметы", async () => {
    render(<SubjectPage subject="bio" onStart={vi.fn()} onNav={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Подготовка к ЕГЭ по биологии");
    expect(await screen.findByText("Зоология")).toBeInTheDocument();
    expect(screen.getByText(/11\s252 задания из открытого банка ФИПИ по предмету «Биология»/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "С чего начать подготовку к ЕГЭ по биологии?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Русский язык" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Физика" })).not.toBeInTheDocument();
  });

  it("«Пройти бесплатную диагностику» запускает предмет, «Тарифы» и «Родителям» ведут на свои страницы, другой предмет — на его страницу", async () => {
    const onStart = vi.fn();
    const onNav = vi.fn();
    render(<SubjectPage subject="soc" onStart={onStart} onNav={onNav} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Пройти бесплатную диагностику/ })[0]); // вверху страницы; вторая — в УТП внизу
    expect(onStart).toHaveBeenCalledWith("soc");
    fireEvent.click(screen.getByRole("button", { name: "Тарифы" }));
    expect(onNav).toHaveBeenCalledWith({ name: "tariffs" });
    fireEvent.click(screen.getByRole("button", { name: "Родителям" }));
    expect(onNav).toHaveBeenCalledWith({ name: "parents" });
    fireEvent.click(screen.getByRole("button", { name: "Биология" }));
    expect(onNav).toHaveBeenCalledWith({ name: "subject-page", subject: "bio" });
    await screen.findByText("Зоология");
  });

  it("сервер не ответил — страница всё равно с заголовком, вопросами и шагами, без списка разделов", async () => {
    vi.mocked(lib.loadSubjectContent).mockResolvedValue(null);
    render(<SubjectPage subject="rus" onStart={vi.fn()} onNav={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("по русскому языку");
    expect(screen.getByRole("heading", { name: "Как проходит подготовка" })).toBeInTheDocument();
    expect(screen.queryByText("Разделы и темы в тренажёре")).not.toBeInTheDocument();
  });

  it("частые вопросы — аккордеон: ответы свёрнуты, раскрываются кликом по вопросу; текст ответа остаётся в разметке", () => {
    render(<SubjectPage subject="bio" onStart={vi.fn()} onNav={vi.fn()} />);
    const q = screen.getByRole("heading", { name: "Можно ли готовиться к ЕГЭ по биологии бесплатно?" });
    const details = q.closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toMatch(/Базовый тариф бесплатный/);
    fireEvent.click(q.closest("summary")!);
    expect(details.open).toBe(true);
  });

  it("УТП — последний блок страницы, за ним нет других разделов; в конце кнопка диагностики по этому предмету", () => {
    const onStart = vi.fn();
    render(<SubjectPage subject="math" onStart={onStart} onNav={vi.fn()} />);
    const usp = screen.getByTestId("subject-usp");
    expect(usp).toHaveTextContent("Почему ЕГЭ·ПРО");
    expect(usp).toHaveTextContent("Объясняет, а не решает за тебя");
    expect(usp).toHaveTextContent("Фиксированная цена и никаких автосписаний");
    const sections = [...document.querySelectorAll("section")];
    expect(sections[sections.length - 1]).toBe(usp);
    fireEvent.click(usp.querySelector("button")!);
    expect(onStart).toHaveBeenCalledWith("math");
  });
});
