// Шаблоны писем-напоминаний (docker/api/lifecycleEmails.js): подстановки, выпадающие абзацы,
// переопределение из админки, оформление. SMTP не трогаем — только сборка письма.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { KINDS, TEMPLATES, SAMPLE_VARS, buildLifecycleEmail, buildSampleEmail, fillBody, fillLine, resolveLifecycleTemplates, ABANDONED_CTA_BY_KIND } from "../lifecycleEmails.js";
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

test("подвал: у писем о сроке тарифа дефолт не говорит «разовое» (они повторяются), у остальных — разовое; подвал редактируется и может быть пустым", async () => {
  await pool.query("delete from public.app_settings where key = 'lifecycle_emails'");
  for (const kind of ["expiring", "expired"]) {
    assert.ok(!/разов/i.test(TEMPLATES[kind].footer), `${kind}: дефолтный подвал не должен обещать разовость`);
    assert.ok(/каждого оплаченного периода/.test(TEMPLATES[kind].footer));
  }
  for (const kind of ["activation", "abandoned"]) assert.ok(/разовое/.test(TEMPLATES[kind].footer));

  const def = await buildSampleEmail("expired");
  assert.ok(def.html.includes("каждого оплаченного периода") && def.text.includes("каждого оплаченного периода"));

  // сохранённый подвал заменяет дефолт; форма без сохранения приоритетнее
  await pool.query("insert into public.app_settings (key, value) values ('lifecycle_emails', $1)", [JSON.stringify({ expired: { subject: "T", bodyText: "B", footer: "Свой подвал" } })]);
  assert.ok((await buildSampleEmail("expired")).html.includes("Свой подвал"));
  assert.ok((await buildSampleEmail("expired", { footer: "Из формы" })).html.includes("Из формы"));

  // пустой подвал: пометки нет ни в HTML, ни в тексте (а не откат на дефолт)
  const empty = await buildSampleEmail("expired", { footer: "" });
  assert.ok(!empty.html.includes("каждого оплаченного периода") && !empty.text.includes("Свой подвал") && !empty.text.includes("каждого оплаченного периода"));
  await pool.query("update public.app_settings set value = $1 where key = 'lifecycle_emails'", [JSON.stringify({ expired: { subject: "T", bodyText: "B", footer: "" } })]);
  assert.ok(!(await buildSampleEmail("expired")).html.includes("каждого оплаченного периода"));
});

// Кнопка/страница письма «Оплата не завершена» зависит от ВИДА платежа (payments.kind), а не только от
// того, что покупали, — найдено на реальных данных прода 26.09.2026 (см. lifecycle.test.js: раньше
// письмо для докупки/продления у уже оплатившего тариф не уходило вовсе). Здесь — что кнопка/путь
// действительно РАЗНЫЕ и ведут туда, где реально можно доплатить именно этот вид платежа.
test("ABANDONED_CTA_BY_KIND: у каждого вида платежа — своя кнопка и путь; неизвестный вид не задан явно", () => {
  assert.equal(ABANDONED_CTA_BY_KIND.tariff.ctaPath, "/tariffs");
  assert.equal(ABANDONED_CTA_BY_KIND.renewal.ctaPath, "/renew");
  assert.equal(ABANDONED_CTA_BY_KIND.addon.ctaPath, "/subjects");
  const paths = new Set(Object.values(ABANDONED_CTA_BY_KIND).map((v) => v.ctaPath));
  assert.equal(paths.size, 3, "у всех трёх видов путь должен отличаться");
  for (const v of Object.values(ABANDONED_CTA_BY_KIND)) assert.match(v.cta, /→$/);
});

test("buildLifecycleEmail: ctx.cta/ctaPath переопределяют кнопку шаблона (нужно письму «Оплата не завершена» под конкретный вид платежа)", async () => {
  const withOverride = await buildLifecycleEmail("abandoned", { имя: "", тариф: "Аттестат" }, { siteUrl: "https://x.test", cta: "Докупить предметы →", ctaPath: "/subjects" });
  assert.match(withOverride.text, /https:\/\/x\.test\/subjects/);
  assert.match(withOverride.text, /Докупить предметы/);
  assert.doesNotMatch(withOverride.text, /\/tariffs/);
  const withoutOverride = await buildLifecycleEmail("abandoned", { имя: "", тариф: "Аттестат" }, { siteUrl: "https://x.test" });
  assert.match(withoutOverride.text, /\/tariffs/, "без переопределения остаётся дефолтный путь шаблона");
});
