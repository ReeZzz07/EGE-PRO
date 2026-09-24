// Текст подвала: то, что админ сохранил, показывается как есть; пусто/нет записи — текст по умолчанию.
import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const upsert = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }), upsert }) },
}));

import { DEFAULT_FOOTER_TEXT, loadLegalEntityInfo, saveLegalEntityInfo } from "./legalEntity";

beforeEach(() => vi.clearAllMocks());

describe("loadLegalEntityInfo", () => {
  it("сохранённый текст подвала возвращается как есть, вместе с реквизитами", async () => {
    maybeSingle.mockResolvedValue({ data: { data: { inn: "123", ogrnip: "456", footerText: "Свой текст" } }, error: null });
    expect(await loadLegalEntityInfo()).toEqual({ inn: "123", ogrnip: "456", footerText: "Свой текст" });
  });

  it("старая запись без footerText или пустой/пробельный текст — текст по умолчанию", async () => {
    maybeSingle.mockResolvedValue({ data: { data: { inn: "1", ogrnip: "2" } }, error: null });
    expect((await loadLegalEntityInfo()).footerText).toBe(DEFAULT_FOOTER_TEXT);
    maybeSingle.mockResolvedValue({ data: { data: { footerText: "   " } }, error: null });
    expect((await loadLegalEntityInfo()).footerText).toBe(DEFAULT_FOOTER_TEXT);
  });

  it("записи нет — по умолчанию, без реквизитов", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadLegalEntityInfo()).toMatchObject({ inn: "", ogrnip: "", footerText: DEFAULT_FOOTER_TEXT });
  });
});

describe("saveLegalEntityInfo", () => {
  it("пишет все три поля в блок legalEntity", async () => {
    await saveLegalEntityInfo({ inn: "1", ogrnip: "2", footerText: "Текст" }, "admin-id");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ key: "legalEntity", data: { inn: "1", ogrnip: "2", footerText: "Текст" }, updated_by: "admin-id" }));
  });
});
