// Таблица пользователей в админке: строки с воронкой, поиск, фильтры «Все/Да/Нет» (инверсия), регион/город
// с режимом «Только/Кроме», чипы включённых фильтров и карточка в модальном окне.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsersTable from "./AdminUsersTable";
import { EMPTY_USER_FILTERS, loadAdminUserDetail, loadAdminUserFacets, searchAdminUsers, type AdminUserListItem } from "../lib/adminUsers";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ profile: { id: "admin-1" } }) }));
vi.mock("../lib/tariffs", () => ({ loadAllTariffs: vi.fn().mockResolvedValue([]) }));
vi.mock("./ui", async (orig) => ({ ...(await orig<typeof import("./ui")>()), useToast: () => ({ push: vi.fn() }) }));
vi.mock("../lib/adminUsers", async (orig) => ({
  ...(await orig<typeof import("../lib/adminUsers")>()),
  searchAdminUsers: vi.fn(),
  loadAdminUserFacets: vi.fn(),
  loadAdminUserDetail: vi.fn(),
}));

const row = (over: Partial<AdminUserListItem>): AdminUserListItem => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  email: "anna@example.org",
  registered_at: "2026-09-20T10:00:00Z",
  full_name: "Анна Иванова",
  tariff_id: "free",
  tariff_expires_at: null,
  is_admin: false,
  discount_percent: null,
  anonymized_at: null,
  tariff_active: false,
  region: "Москва",
  city: "Москва",
  confirmed: true,
  onboarded: true,
  diagnostic: false,
  first_task: false,
  ai_request: false,
  paid: false,
  abandoned: false,
  ...over,
});

const ROWS = [
  row({}),
  row({ id: "22222222-aaaa-bbbb-cccc-000000000002", email: "boris@example.org", full_name: "Борис Петров", region: "Татарстан", city: "Казань", paid: true, tariff_id: "attestat", tariff_active: true, tariff_expires_at: "2026-10-20T00:00:00Z" }),
  row({ id: "33333333-aaaa-bbbb-cccc-000000000003", email: "vera@example.org", full_name: null, abandoned: true, confirmed: false, onboarded: false, region: null, city: null }),
];

const lastCall = () => {
  const calls = vi.mocked(searchAdminUsers).mock.calls;
  return calls[calls.length - 1];
};
const lastFilters = () => lastCall()[0];

beforeEach(() => {
  vi.mocked(searchAdminUsers).mockReset().mockResolvedValue({ rows: ROWS, total: 3, overall: 40 });
  vi.mocked(loadAdminUserFacets).mockReset().mockResolvedValue({
    regions: [
      { value: "Москва", count: 2 },
      { value: "Татарстан", count: 1 },
    ],
    cities: [
      { value: "Москва", region: "Москва", count: 2 },
      { value: "Казань", region: "Татарстан", count: 1 },
    ],
  });
  vi.mocked(loadAdminUserDetail).mockReset().mockResolvedValue(null);
});

describe("AdminUsersTable", () => {
  it("показывает таблицу: имя/email/id, регион·город, значки воронки, «оплата» (оплатил / бросил), общее число", async () => {
    render(<AdminUsersTable />);
    expect(await screen.findByText("Анна Иванова")).toBeInTheDocument();
    expect(screen.getByText("Борис Петров")).toBeInTheDocument();
    // без имени вместо него показывается email (и в заголовке строки, и отдельной строкой)
    expect(screen.getAllByText("vera@example.org")).toHaveLength(2);
    expect(screen.getByText(/Всего:/)).toHaveTextContent("Всего: 40");
    expect(screen.getAllByTitle("Есть успешный платёж")).toHaveLength(1);
    expect(screen.getAllByTitle("Начал платёж, но не завершил")).toHaveLength(1);
    expect(screen.getAllByTitle("Почта не подтверждена")).toHaveLength(1);
    expect(screen.getByText("Татарстан")).toBeInTheDocument();
    expect(searchAdminUsers).toHaveBeenCalledWith(EMPTY_USER_FILTERS, 0, 25, "registered", "desc");
  });

  it("поиск по id/email/имени уходит на сервер в строке q и сбрасывает страницу", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.change(screen.getByLabelText("Поиск по id, email или имени"), { target: { value: "boris" } });
    await waitFor(() => expect(lastFilters().q).toBe("boris"));
    expect(lastCall()[1]).toBe(0);
    expect(await screen.findByText(/Найдено/)).toHaveTextContent("Найдено 3 из 40");
  });

  it("фильтр воронки: «Да» → yes, «Нет» → no (инверсия), «Все» → выключен; появляется и убирается чип", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("button", { name: /Фильтры/ }));

    const paid = screen.getByRole("radiogroup", { name: "Совершил платёж" });
    fireEvent.click(within(paid).getByRole("radio", { name: "Да" }));
    await waitFor(() => expect(lastFilters().funnel.paid).toBe("yes"));
    expect(screen.getByRole("button", { name: "Убрать фильтр: Совершил платёж: да" })).toBeInTheDocument();

    fireEvent.click(within(paid).getByRole("radio", { name: "Нет" }));
    await waitFor(() => expect(lastFilters().funnel.paid).toBe("no"));
    expect(screen.getByRole("button", { name: "Убрать фильтр: Совершил платёж: нет" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Убрать фильтр: Совершил платёж: нет" }));
    await waitFor(() => expect(lastFilters().funnel.paid).toBe("any"));
    expect(screen.queryByRole("list", { name: "Включённые фильтры" })).not.toBeInTheDocument();
  });

  it("семь фильтров воронки на месте, условия складываются", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("button", { name: /Фильтры/ }));
    for (const label of ["Подтвердил аккаунт", "Прошёл онбординг", "Прошёл диагностику", "Решил первую задачу", "Отправил запрос ИИ-репетитору", "Совершил платёж", "Начал, но не завершил платёж"]) {
      expect(screen.getByRole("radiogroup", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Прошёл онбординг" })).getByRole("radio", { name: "Да" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Начал, но не завершил платёж" })).getByRole("radio", { name: "Нет" }));
    await waitFor(() => expect(lastFilters().funnel).toMatchObject({ onboarded: "yes", abandoned: "no", paid: "any" }));
    expect(screen.getByRole("button", { name: /Фильтры/ })).toHaveTextContent("2");
  });

  it("регион и город: выбор из справочника и режим «Кроме» (инверсия)", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("button", { name: /Фильтры/ }));

    fireEvent.change(screen.getByLabelText("Регион"), { target: { value: "Москва" } });
    await waitFor(() => expect(lastFilters()).toMatchObject({ region: "Москва", regionNot: false }));

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Режим фильтра по региону" })).getByRole("radio", { name: "Кроме" }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ region: "Москва", regionNot: true }));
    expect(screen.getByRole("button", { name: "Убрать фильтр: Не из региона: Москва" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Город"), { target: { value: "Казань" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Режим фильтра по городу" })).getByRole("radio", { name: "Кроме" }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ city: "Казань", cityNot: true }));
  });

  it("«Сбросить всё» возвращает пустые фильтры", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.change(screen.getByLabelText("Поиск по id, email или имени"), { target: { value: "x" } });
    await waitFor(() => expect(lastFilters().q).toBe("x"));
    fireEvent.click(screen.getByRole("button", { name: /Сбросить всё/ }));
    await waitFor(() => expect(lastFilters()).toEqual(EMPTY_USER_FILTERS));
  });

  it("сортировка: клик по «Регистрация» меняет направление, по «Пользователь» — сортирует по имени", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    fireEvent.click(screen.getByRole("button", { name: /Регистрация/ }));
    await waitFor(() => expect(lastCall().slice(3)).toEqual(["registered", "asc"]));
    fireEvent.click(screen.getByRole("button", { name: /Пользователь/ }));
    await waitFor(() => expect(lastCall().slice(3)).toEqual(["name", "asc"]));
  });

  it("карточка открывается в модальном окне по кнопке и закрывается по Esc", async () => {
    render(<AdminUsersTable />);
    await screen.findByText("Анна Иванова");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть карточку: Борис Петров" }));
    expect(await screen.findByRole("dialog", { name: "Карточка пользователя" })).toBeInTheDocument();
    await waitFor(() => expect(loadAdminUserDetail).toHaveBeenCalledWith("22222222-aaaa-bbbb-cccc-000000000002"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("пустой результат — понятное сообщение и кнопка сброса; ошибка сервера — alert", async () => {
    vi.mocked(searchAdminUsers).mockResolvedValue({ rows: [], total: 0, overall: 40 });
    const { unmount } = render(<AdminUsersTable />);
    fireEvent.change(await screen.findByLabelText("Поиск по id, email или имени"), { target: { value: "zzz" } });
    expect(await screen.findByText("Никого не нашлось")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Сбросить/ }).length).toBeGreaterThan(0);
    unmount();

    vi.mocked(searchAdminUsers).mockRejectedValue(new Error("Нет доступа"));
    render(<AdminUsersTable />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа");
  });
});
