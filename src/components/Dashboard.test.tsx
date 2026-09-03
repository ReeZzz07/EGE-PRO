// MySubjectsSection (Dashboard.tsx) — реальное место, где предмет добавляется (см.
// lib/profileSubjects.ts) и где тариф честно объясняет отказ, если лимит предметов исчерпан
// (см. supabase/migrations/0014_profile_subjects.sql: enforce_subject_limit, и его серверный
// тест docker/api/test/subjectLimit.test.js — здесь то же самое поведение с клиентской стороны,
// через тост, а не прямую вставку в БД).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MySubjectsSection } from "./Dashboard";
import { ToastProvider } from "./ui";
import { addProfileSubject } from "../lib/profileSubjects";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    profile: { id: "u1", name: "Т", email: "t@t.local", isAdmin: false, tariffId: "free", subjects: ["math"] },
    refreshSubjects: vi.fn(),
  }),
}));
vi.mock("../lib/profileSubjects", () => ({ addProfileSubject: vi.fn() }));

function renderSection() {
  return render(
    <ToastProvider>
      <MySubjectsSection onNav={vi.fn()} />
    </ToastProvider>
  );
}

describe("MySubjectsSection — добавление предмета", () => {
  it("уже добавленный предмет (МАТ) не предлагается в пикере", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Добавить предмет/ }));
    expect(screen.queryByRole("button", { name: "МАТ" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ФИЗ" })).toBeInTheDocument();
  });

  it("успешное добавление — тост «Добавлено» и предмет уходит из пикера", async () => {
    vi.mocked(addProfileSubject).mockResolvedValue({});
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Добавить предмет/ }));
    fireEvent.click(screen.getByRole("button", { name: "ФИЗ" }));

    await waitFor(() => expect(screen.getByText("Добавлено: Физика")).toBeInTheDocument());
    expect(addProfileSubject).toHaveBeenCalledWith("u1", "fiz");
  });

  it("отказ по лимиту тарифа — сообщение из БД показывается тостом, пикер остаётся открытым", async () => {
    vi.mocked(addProfileSubject).mockResolvedValue({ error: "На текущем тарифе больше предметов не добавить — открой тариф с бо́льшим числом предметов." });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Добавить предмет/ }));
    fireEvent.click(screen.getByRole("button", { name: "ФИЗ" }));

    await waitFor(() => expect(screen.getByText(/тарифе больше предметов не добавить/)).toBeInTheDocument());
    // пикер не закрылся молча после ошибки — предмет всё ещё предлагается для повторной попытки
    expect(screen.getByRole("button", { name: "ФИЗ" })).toBeInTheDocument();
  });
});
