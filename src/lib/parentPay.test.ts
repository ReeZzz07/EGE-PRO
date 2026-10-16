import { afterEach, describe, expect, it, vi } from "vitest";
import { createParentLink, getParentLinkStatus } from "./parentPay";
import * as supabaseLib from "./supabase";

vi.mock("./supabase", async (orig) => ({ ...(await orig<typeof import("./supabase")>()), apiFetch: vi.fn() }));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const lastBody = () => {
  const c = vi.mocked(supabaseLib.apiFetch).mock.calls;
  return JSON.parse(String(c[c.length - 1][1]?.body));
};

afterEach(() => vi.clearAllMocks());

describe("createParentLink", () => {
  it("место нажатия передаётся в теле запроса; без места тело пустое", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ url: "https://x/pay-for/t" }));
    expect(await createParentLink("ai-limit")).toEqual({ url: "https://x/pay-for/t" });
    expect(lastBody()).toEqual({ place: "ai-limit" });
    await createParentLink();
    expect(lastBody()).toEqual({});
  });
});

describe("getParentLinkStatus", () => {
  it("отдаёт состояние и даты с сервера", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValue(ok({ state: "waiting", sentAt: "2026-10-10T10:00:00Z", expiresAt: "2026-10-24T10:00:00Z" }));
    expect(await getParentLinkStatus()).toEqual({ state: "waiting", sentAt: "2026-10-10T10:00:00Z", expiresAt: "2026-10-24T10:00:00Z" });
  });

  it("ошибка ответа и сбой сети дают none: плашка просто не покажется", async () => {
    vi.mocked(supabaseLib.apiFetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    expect((await getParentLinkStatus()).state).toBe("none");
    vi.mocked(supabaseLib.apiFetch).mockRejectedValueOnce(new Error("offline"));
    expect((await getParentLinkStatus()).state).toBe("none");
  });
});
