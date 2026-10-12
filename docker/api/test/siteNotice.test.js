// Объявление о сбое почты (docker/api/siteNotice.js): что попадает посетителям и что — нет.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAIL_NOTICE_TEXT, MAIL_NOTICE_KEY, MAIL_NOTICE_MAX, getPublicMailNotice, normalizeMailNotice } from "../siteNotice.js";
import { pool } from "./helpers.js";

let backup = null;
let backedUp = false;

async function setNotice(value) {
  if (!backedUp) {
    backup = (await pool.query("select value from public.app_settings where key = $1", [MAIL_NOTICE_KEY])).rows[0]?.value ?? null;
    backedUp = true;
  }
  if (value === null) await pool.query("delete from public.app_settings where key = $1", [MAIL_NOTICE_KEY]);
  else
    await pool.query(
      `insert into public.app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
      [MAIL_NOTICE_KEY, JSON.stringify(value)]
    );
}

after(async () => {
  if (backedUp) {
    if (backup === null) await pool.query("delete from public.app_settings where key = $1", [MAIL_NOTICE_KEY]);
    else await pool.query("update public.app_settings set value = $2 where key = $1", [MAIL_NOTICE_KEY, JSON.stringify(backup)]);
  }
  await pool.end();
});

test("normalizeMailNotice: включено только при enabled === true; пустой текст заменяется стандартным; длина ограничена", () => {
  assert.deepEqual(normalizeMailNotice(null), { enabled: false, text: DEFAULT_MAIL_NOTICE_TEXT });
  assert.equal(normalizeMailNotice({ enabled: "true", text: "x" }).enabled, false);
  assert.equal(normalizeMailNotice({ enabled: true, text: "   " }).text, DEFAULT_MAIL_NOTICE_TEXT);
  assert.equal(normalizeMailNotice({ enabled: true, text: "Яндекс  чинит" + String.fromCharCode(10, 10) + "почту" }).text, "Яндекс чинит почту");
  assert.equal(normalizeMailNotice({ enabled: true, text: "я".repeat(5000) }).text.length, MAIL_NOTICE_MAX);
  assert.equal(normalizeMailNotice({ enabled: true, text: 42 }).text, DEFAULT_MAIL_NOTICE_TEXT);
});

test("getPublicMailNotice: пока настройки нет или объявление выключено — active: false и пустой текст", async () => {
  await setNotice(null);
  assert.deepEqual(await getPublicMailNotice({ fresh: true }), { active: false, text: "" });
  await setNotice({ enabled: false, text: "Скрытый текст не должен уйти наружу" });
  assert.deepEqual(await getPublicMailNotice({ fresh: true }), { active: false, text: "" });
});

test("getPublicMailNotice: включено — отдаёт текст админа, а при пустом тексте стандартный", async () => {
  await setNotice({ enabled: true, text: "Яндекс устраняет неполадку" });
  assert.deepEqual(await getPublicMailNotice({ fresh: true }), { active: true, text: "Яндекс устраняет неполадку" });
  await setNotice({ enabled: true, text: "" });
  const n = await getPublicMailNotice({ fresh: true });
  assert.equal(n.active, true);
  assert.equal(n.text, DEFAULT_MAIL_NOTICE_TEXT);
});

test("getPublicMailNotice: ответ короткое время кешируется, fresh обходит кеш", async () => {
  await setNotice({ enabled: true, text: "Первый" });
  assert.equal((await getPublicMailNotice({ fresh: true })).text, "Первый");
  await setNotice({ enabled: true, text: "Второй" });
  assert.equal((await getPublicMailNotice()).text, "Первый");
  assert.equal((await getPublicMailNotice({ fresh: true })).text, "Второй");
});
