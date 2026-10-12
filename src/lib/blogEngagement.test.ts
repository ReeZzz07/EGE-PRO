import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVisitorId, loadAdminEngagement, loadAllEngagement, loadEngagement, postComment, registerShare, shareLink, toggleLike } from "./blogEngagement";
import * as supabaseLib from "./supabase";

vi.mock("./supabase", async (orig) => ({ ...(await orig<typeof import("./supabase")>()), apiFetch: vi.fn() }));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body }) as unknown as Response;
const lastCall = () => (() => { const c = vi.mocked(supabaseLib.apiFetch).mock.calls; return c[c.length - 1]; })();
const headerOf = (name: string) => new Headers(lastCall()[1]?.headers).get(name);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("getVisitorId", () => {
  it("создаёт постоянный идентификатор в браузере: второй вызов отдаёт тот же", () => {
    const a = getVisitorId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(getVisitorId()).toBe(a);
    expect(localStorage.getItem("ege-pro.visitor-id")).toBe(a);
  });

  it("испорченное значение в хранилище заменяется новым, а недоступное хранилище не ломает — идентификатор живёт в памяти", () => {
    localStorage.setItem("ege-pro.visitor-id", "мусор");
    const fixed = getVisitorId();
    expect(fixed).not.toBe("мусор");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const mem = getVisitorId();
    expect(mem).toMatch(/^[0-9a-f-]{36}$/i);
    expect(getVisitorId()).toBe(mem);
  });
});

describe("запросы", () => {
  it("каждый запрос несёт идентификатор посетителя в заголовке; slug кодируется", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ stats: { views: 1 }, comments: [], nextBeforeId: null }));
    await loadEngagement("слаг с пробелом");
    expect(lastCall()[0]).toBe(`/blog-engagement/${encodeURIComponent("слаг с пробелом")}`);
    expect(headerOf("x-visitor-id")).toBe(getVisitorId());
  });

  it("ответ 404 (черновик) и сбой сети дают null, а не исключение", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(fail(404, { error: "Статья не найдена" }));
    expect(await loadEngagement("x")).toBeNull();
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect(await loadEngagement("x")).toBeNull();
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect(await loadAllEngagement()).toEqual({});
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(fail(403, { error: "admin only" }));
    expect(await loadAdminEngagement()).toBeNull();
  });

  it("ошибки действий приходят готовым текстом сервера; сеть — понятным текстом", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(fail(429, { error: "Слишком много комментариев за час — подожди немного" }));
    expect((await postComment("x", "текст")).error).toMatch(/Слишком много/);
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect((await toggleLike("x")).error).toMatch(/Нет связи/);
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect(await registerShare("x", "vk")).toBeNull();
  });

  it("комментарий и репост уходят JSON-телом", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ comment: { id: 1 }, stats: {} }));
    await postComment("x", "Привет");
    expect(lastCall()[1]?.method).toBe("POST");
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({ body: "Привет" });
    expect(headerOf("content-type")).toBe("application/json");
    await registerShare("x", "telegram");
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({ channel: "telegram" });
  });
});

describe("shareLink", () => {
  const url = "https://ege-tutor.ru/blog/a b";
  it("ссылки соцсетей содержат закодированный адрес статьи", () => {
    expect(shareLink("vk", url, "Заголовок")).toBe(`https://vk.com/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent("Заголовок")}`);
    expect(shareLink("telegram", url, "Заголовок")).toContain("https://t.me/share/url?url=");
    expect(shareLink("ok", url, "Заголовок")).toContain("https://connect.ok.ru/offer?url=");
    const wa = shareLink("whatsapp", url, "Заголовок");
    expect(wa.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(wa)).toContain(`Заголовок ${url}`);
  });
});
