import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPublicMailNotice } from "./mailNotice";
import * as supabaseLib from "./supabase";

vi.mock("./supabase", async (orig) => ({ ...(await orig<typeof import("./supabase")>()), apiFetch: vi.fn() }));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

afterEach(() => vi.clearAllMocks());

describe("loadPublicMailNotice", () => {
  it("активное объявление приходит с текстом", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ active: true, text: "Яндекс чинит почту" }));
    expect(await loadPublicMailNotice()).toEqual({ active: true, text: "Яндекс чинит почту" });
  });

  it("выключено, пустой текст, ответ с ошибкой и сбой сети дают «объявления нет», а не исключение", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(ok({ active: false, text: "" }));
    expect(await loadPublicMailNotice()).toEqual({ active: false, text: "" });
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce(ok({ active: true, text: "" }));
    expect((await loadPublicMailNotice()).active).toBe(false);
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    expect((await loadPublicMailNotice()).active).toBe(false);
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect((await loadPublicMailNotice()).active).toBe(false);
  });
});
