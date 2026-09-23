// Шаблоны писем-напоминаний (docker/api/lifecycleEmails.js): подстановки, выпадающие абзацы,
// переопределение из админки, оформление. SMTP не трогаем — только сборка письма.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { KINDS, TEMPLATES, SAMPLE_VARS, buildLifecycleEmail, buildSampleEmail, fillBody, fillLine, resolveLifecycleTemplates } from "../lifecycleEmails.js";
import { pool } from "./helpers.js";

after(async () => {
  await pool.query("delete from public.app_settings where key = 'lifecycle_emails'");
  await pool.end();
});

test("fillBody: подставляет значения; абзац с пустой подстановкой выпадает целиком, неизвестные {ключи} остаются как есть", () => {
  const text = "Привет, {имя}.\n\nПриостановлено: {приостановлено}.\n\nОстаётся {неизвестно}.";
  assert.deepEqual(fillBody(text, { имя: "Аня", приостановлено: "" }), ["Привет, Аня.", "Остаётся {неизвестно}."]);
  assert.deepEqual(fillBody(text, { имя: "Аня", приостановлено: "3" }), ["Привет, Аня.", "Приостановлено: 3.", "Остаётся {неизвестно}."]);
});

test("fillLine: подстановки в теме", () => {
  assert.equal(fillLine("Тариф «{тариф}» заканчивается {дата}", { тариф: "ВУЗ", дата: "12 октября" }), "Тариф «ВУЗ» заканчивается 12 октября");
});

test("у каждого письма дефолтные тема и текст непусты и используют только свои подстановки", () => {
  for (const kind of KINDS) {
    const t = TEMPLATES[kind];
    assert.ok(t.subject && t.bodyText && t.eyebrow && t.cta);
    for (const m of (t.subject + t.bodyText).matchAll(/\{([^{}\s]+)\}/g)) {
      assert.ok(t.placeholders.includes(m[1]), `${kind}: подстановка {${m[1]}} не объявлена в placeholders`);
      assert.ok(m[1] in SAMPLE_VARS, `${kind}: нет образцового значения для {${m[1]}}`);
    }
  }
});

test("образец каждого письма: оформление как у приветственного (эйбрау, приветствие, кнопка), подстановки заполнены, скидка видна", async () => {
  for (const kind of KINDS) {
    const m = await buildSampleEmail(kind);
    assert.ok(m.html.includes(TEMPLATES[kind].eyebrow), `${kind}: нет эйбрау`);
    assert.ok(m.html.includes("Аня, привет!"));
    assert.ok(m.html.includes(TEMPLATES[kind].cta.replace(/&/g, "&amp;")) || m.html.includes(TEMPLATES[kind].cta));
    assert.ok(m.html.includes("−30%"), `${kind}: в образце должна быть скидка`);
    assert.ok(!/\{[^{}\s]+\}/.test(m.subject + m.text), `${kind}: остались неподставленные {ключи}`);
  }
  const activation = await buildSampleEmail("activation");
  assert.match(activation.html, /border-left:3px solid/, "у напоминания активации — нумерованные цветные пункты, как в приветственном");
  const expiring = await buildSampleEmail("expiring");
  assert.ok(expiring.html.includes("что продлеваем"), "у писем о сроке — карточка состава продления");
  assert.ok(expiring.html.includes("/renew"), "кнопка ведёт на /renew");
});

test("expired: абзац про приостановленные предметы появляется только если такие есть", async () => {
  const withFrozen = await buildLifecycleEmail("expired", { ...SAMPLE_VARS, приостановлено: "2" }, { siteUrl: "https://x.test" });
  const without = await buildLifecycleEmail("expired", { ...SAMPLE_VARS, приостановлено: "" }, { siteUrl: "https://x.test" });
  assert.ok(withFrozen.text.includes("приостановлен"));
  assert.ok(!without.text.includes("приостановлен"));
});

test("переопределение из админки: сохранённые тема/текст заменяют дефолт, форма без сохранения — приоритетнее сохранённого", async () => {
  await pool.query("delete from public.app_settings where key = 'lifecycle_emails'");
  assert.equal((await resolveLifecycleTemplates()).abandoned.subject, TEMPLATES.abandoned.subject);

  await pool.query("insert into public.app_settings (key, value) values ('lifecycle_emails', $1)", [JSON.stringify({ abandoned: { subject: "Своя тема {тариф}", bodyText: "Свой текст про «{тариф}»." } })]);
  const saved = await buildLifecycleEmail("abandoned", { имя: "", тариф: "ВУЗ" }, { siteUrl: "https://x.test" });
  assert.equal(saved.subject, "Своя тема ВУЗ");
  assert.ok(saved.text.includes("Свой текст про «ВУЗ»."));
  assert.ok(saved.text.startsWith("Привет!"), "без имени — обезличенное приветствие");

  const draft = await buildLifecycleEmail("abandoned", { имя: "Аня", тариф: "ВУЗ" }, { siteUrl: "https://x.test" }, { subject: "Черновик", bodyText: "Черновой текст." });
  assert.equal(draft.subject, "Черновик");
  assert.ok(draft.text.includes("Черновой текст."));

  // остальные письма не затронуты
  assert.equal((await resolveLifecycleTemplates()).activation.subject, TEMPLATES.activation.subject);
});
