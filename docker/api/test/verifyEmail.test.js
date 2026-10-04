// Письмо подтверждения почты (docker/api/mailer.js → buildVerifyEmail): оформление как у остальных писем платформы,
// ссылка и в тексте, и в кнопке, честно сказано про срок и про второй клик на странице подтверждения.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerifyEmail } from "../mailer.js";

const URL = "https://ege-tutor.ru/verify-email?token=abc%2B123";

test("письмо подтверждения: тема, кнопка со ссылкой, ссылка текстом, срок 24 часа, подсказка про вторую кнопку", () => {
  const m = buildVerifyEmail(URL);
  assert.equal(m.subject, "Подтверди email — ЕГЭ·ПРО");
  assert.ok(m.html.includes(`href="${URL}"`));
  assert.ok(m.html.includes("Подтвердить email"));
  assert.ok(m.html.includes("ЕГЭ·ПРО"), "фирменная шапка");
  assert.ok(m.text.includes(URL), "в текстовой версии та же ссылка");
  assert.match(m.text, /24 часа/);
  assert.match(m.html, /Подтвердить почту и войти/);
  assert.match(m.html, /проигнорируй это письмо/);
});

test("письмо подтверждения: ссылка экранируется в html, адрес сайта в ссылках берётся из самой ссылки", () => {
  const m = buildVerifyEmail('https://ege-tutor.ru/verify-email?token="><script>x</script>');
  assert.ok(!m.html.includes('"><script>'), "кавычки и скобки в токене экранируются");
  const ok = buildVerifyEmail("https://example.org/verify-email?token=t");
  assert.ok(ok.html.includes("https://example.org"), "ссылка на сайт в шапке — с того же домена");
});
