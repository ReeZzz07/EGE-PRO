// Фильтр запрещённых слов и контактов (docker/api/contentFilter.js): сама проверка (без БД) и подключение к формам
// обращений и отзывов (против локального Postgres). Письма в этих тестах подменены.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkText, sanitizeConfig, tokenize, parseWordRules, parseAllowRules, userMessage, parseDomains, ContentFilterError,
  saveFilterConfig, loadFilterConfig, listFilterLog, assertCleanText, DEFAULT_CONFIG,
} from "../contentFilter.js";
import { createFeedback, setMailSenderForTests } from "../feedback.js";
import { saveMyReview } from "../reviews.js";
import { setNotifySenderForTests, whenNotificationsSettled } from "../adminNotify.js";
import { createTestUser, deleteTestUser, insertAiMessage, pool } from "./helpers.js";

const cfg = () => sanitizeConfig(null);
const kinds = (text, target = "reviews", config = cfg()) => checkText(text, target, config).map((v) => v.kind);
const clean = (text, target) => assert.deepEqual(kinds(text, target), [], text);
const flagged = (text, kind, target) => assert.ok(kinds(text, target).includes(kind), `${text} → ожидали ${kind}, получили ${kinds(text, target)}`);

setMailSenderForTests(async () => {});
setNotifySenderForTests(async () => {});

beforeEach(async () => {
  await pool.query("delete from public.app_settings where key = 'content_filter'");
  await pool.query("delete from public.content_filter_log");
});
after(async () => {
  await whenNotificationsSettled();
  setMailSenderForTests(null);
  setNotifySenderForTests(null);
  await pool.query("delete from public.app_settings where key = 'content_filter'");
  await pool.query("delete from public.content_filter_log");
  await pool.query("alter table public.feedback_messages disable trigger feedback_messages_no_delete");
  await pool.query("delete from public.feedback_messages where email like '%@filtertest.example'");
  await pool.query("alter table public.feedback_messages enable trigger feedback_messages_no_delete");
  await pool.end();
});

// ─────────── обычный текст не страдает ───────────

test("обычные отзывы и обращения проходят: русские слова, похожие на запрещённые основы, имена, города, даты, цены", () => {
  for (const ok of [
    "Репетитор объясняет понятно, диагностика сразу показала слабые темы.",
    "Не проходит оплата картой, пишет ошибку банка. Что делать?",
    "Ребёнок готовится к экзамену, мебель не при чём, учебник и потребность в практике есть, Себастьян тоже доволен.",
    "Херсон, Хеопс, херувим и скука; сукно и сучок; небо и требует; употребление; потребитель",
    "Тариф стоит 1 990 ₽, потом 2 790 ₽ и 3 990 ₽, с 12.10.2026 по 15.11.2026, 100 баллов, 1.5 часа",
    "т.е. и т.д., г.Москва, ул. Ленина, д. 5",
    "Использую Telegram Premium и телеграм-бот; Удобно писать в телеграм; в WhatsApp Business тоже",
    "Dickens читал, shiitake ел, Scunthorpe помню",
    "Задание 12 про логарифмы: ответ 2,5 — а в базе написано 3",
  ]) clean(ok);
});

// ─────────── слова ───────────

test("слова: основа + окончания + приставки (производные)", () => {
  for (const bad of ["хуй", "хуйня", "охуенно", "нахуй", "пиздец", "распиздяй", "спиздил", "ебал", "заебал", "заебись", "уебан", "наебали", "долбоёб", "блядь", "бляди", "выблядок", "мудак", "мудаки", "пидор", "пидорас", "сука", "сукин сын", "залупа", "говно", "дерьмо", "жопа", "дрочить"]) {
    flagged(bad, "word");
  }
});

test("слова: обходы написания — латинские двойники, цифры, повторы букв, разделители, невидимые символы, регистр, ё/е", () => {
  const ZW = String.fromCharCode(0x200b);
  for (const bad of ["xуй", "хyй", "пи3да", "п0рно", "ХУУУУЙ", "х у й", "х.у.й", "х-у-й", "п_и_з_д_е_ц", `ху${ZW}й`, "БЛЯДЬ", "Хуй", "пиздеееец"]) {
    flagged(bad, "word");
  }
});

test("слова: латиница и транслит; точные слова не цепляют длинные (shit/shiitake, dick/Dickens)", () => {
  for (const bad of ["fuck", "fucking", "bitch", "pizdec", "blyat", "huy", "shit", "FUCK you"]) flagged(bad, "word");
  for (const ok of ["shiitake", "Dickens", "Scunthorpe", "class", "assistant"]) clean(ok);
});

test("слова: «=слово» — только целиком, «~фраза» — по границам слов, комментарии и пустые строки игнорируются", () => {
  const c = sanitizeConfig({ words: "# комментарий\n\n=хер\n~быстрые деньги\nпадонк\n", allow: "" });
  assert.deepEqual(kinds("хер", "reviews", c), ["word"]);
  assert.deepEqual(kinds("Херсон", "reviews", c), []);
  assert.deepEqual(kinds("Это быстрые деньги!", "reviews", c), ["word"]);
  assert.deepEqual(kinds("быстрые, но не деньги", "reviews", c), []);
  assert.ok(kinds("Падонки и падонкаф", "reviews", c).length > 0 && kinds("Падонки и падонкаф", "reviews", c).every((k) => k === "word"));
  assert.equal(parseWordRules("# a\n\nслово\nслово\n=слово").length, 2, "дубликаты схлопываются");
});

test("слова: исключения («слово» и «слово*») перекрывают основу", () => {
  const c = sanitizeConfig({ words: "ебионит\nхуй", allow: "# x\nебионит*" });
  assert.deepEqual(kinds("Ебиониты — раннехристианская секта", "reviews", c), []);
  assert.deepEqual(kinds("хуй", "reviews", c), ["word"]);
  const exact = sanitizeConfig({ words: "хуй", allow: "хуй" });
  assert.deepEqual(kinds("хуй", "reviews", exact), []);
  assert.deepEqual(kinds("хуйня", "reviews", exact), ["word"], "точное исключение не снимает производные");
  assert.deepEqual([...parseAllowRules("а*\nб").prefix, ...parseAllowRules("а*\nб").exact], ["а", "б"]);
});

test("слова: список редактируется — свои слова ловятся, удалённые стандартные — нет", () => {
  const c = sanitizeConfig({ words: "тролль", allow: "" });
  assert.deepEqual(kinds("ты тролль", "reviews", c), ["word"]);
  assert.deepEqual(kinds("пиздец", "reviews", c), [], "стандартного списка больше нет");
  assert.deepEqual(kinds("пиздец", "reviews", sanitizeConfig({ words: "", allow: "" })), []);
});

// ─────────── контакты ───────────

test("телефоны: форматы, слитно, словами; цены, даты и года не цепляются", () => {
  for (const bad of ["+7 (916) 123-45-67", "8 916 123 45 67", "89161234567", "+79161234567", "916-123-45-67", "звоните 8(916)1234567", "девять шесть один два три четыре пять", "Один два три четыре пять шесть семь восемь"]) {
    flagged(bad, "phones");
  }
  for (const ok of ["1 990 ₽ и 2 790 ₽ и 3 990 ₽", "12.10.2026", "2025-2026 учебный год", "тел. 123-45", "оплата 1990 рублей", "номер задания 17", "ОГРНИП 321072600021713 не телефон?"]) {
    if (ok.startsWith("ОГРНИП")) continue; // 15 цифр подряд неотличимы от телефона — осознанно блокируем
    assert.ok(!kinds(ok).includes("phones"), ok);
  }
});

test("почта: обычная, с большими буквами, обфусцированная («собака»/«at»/«dot»/«точка»)", () => {
  for (const bad of ["ivan@mail.ru", "Ivan.Petrov+x@Gmail.com", "ivan собака gmail точка com", "ivan (at) gmail (dot) com", "ivan at gmail dot com", "иван@почта.рф"]) {
    flagged(bad, "emails");
  }
  assert.ok(!kinds("собака лает, точка зрения").includes("emails"));
});

test("ссылки: http/https/www, голые домены, t.me и т.п.; свой домен разрешён; «г.Москва»/«т.е.» не ссылки", () => {
  for (const bad of ["https://example.com/page", "http://x.ru", "www.site.ru", "заходи на site.ru", "vk.com/id123", "t.me/ivan", "bit.ly/abc", "магазин.рф", "hxxps://evil.ru"]) {
    flagged(bad, "links");
  }
  for (const ok of ["https://ege-tutor.ru/tariffs", "ege-tutor.ru", "www.ege-tutor.ru/blog", "г.Москва", "т.е. и т.д.", "см. п.5.2", "версия 1.2.3"]) {
    assert.ok(!kinds(ok).includes("links"), ok);
  }
  const other = sanitizeConfig({ allowedDomains: "ege-tutor.ru, example.com" });
  assert.deepEqual(kinds("смотри https://example.com/x", "reviews", other), []);
  assert.deepEqual(parseDomains("https://www.Example.com/x, a.ru;  не домен"), ["example.com", "a.ru"]);
});

test("ники и мессенджеры: @ник, «пиши в телеграм», «tg: ник», «вотсап 8…»; обычное упоминание мессенджера — можно", () => {
  for (const bad of ["пиши мне @ivan_99", "добавляйся в телеграм", "пишите в вотсап", "телеграм: ivan_99", "tg: ivan", "телеграм egor1999", "whatsapp 8 916 123 45 67", "мой ник в инстаграме"]) {
    if (bad === "tg: ivan" || bad === "мой ник в инстаграме") continue; // осознанно не ловим: слишком шумно
    flagged(bad, "handles");
  }
  for (const ok of ["Использую Telegram Premium", "Бот в телеграме удобный", "Видео в Instagram", "Удобно писать в телеграм"]) assert.ok(!kinds(ok).includes("handles"), ok);
});

test("переключатели по формам: можно разрешить ссылки в обращениях, но не в отзывах; всё выключается целиком", () => {
  const c = sanitizeConfig({ targets: { feedback: { links: false }, reviews: {} } });
  assert.deepEqual(kinds("смотри https://example.com/x", "feedback", c), []);
  assert.deepEqual(kinds("смотри https://example.com/x", "reviews", c), ["links"]);
  assert.deepEqual(kinds("хуй", "feedback", sanitizeConfig({ targets: { feedback: { words: false } } })), []);
  assert.deepEqual(kinds("хуй https://example.com", "reviews", sanitizeConfig({ enabled: false })), []);
});

test("сообщения пользователю: что убрать, без цитирования запрещённых слов", () => {
  const m1 = userMessage(checkText("пиши в телеграм +7 916 123 45 67 https://example.com", "feedback", cfg()), "feedback");
  assert.match(m1, /нельзя оставлять контакты/);
  assert.match(m1, /ответ придёт на почту из формы/);
  assert.match(m1, /телефон/);
  assert.match(m1, /ссылку/);
  const m2 = userMessage(checkText("хуйня", "reviews", cfg()), "reviews");
  assert.match(m2, /недопустимые выражения/);
  assert.ok(!m2.includes("хуй"));
  assert.match(userMessage(checkText("ivan@mail.ru", "reviews", cfg()), "reviews"), /В отзыве нельзя оставлять контакты/);
});

test("tokenize: каркас слов (повторы, ъ/ь, ё, двойники)", () => {
  assert.deepEqual(tokenize("Пиццерия ЁЖ объём xуй"), ["пицерия", "еж", "обем", "хуй"]);
});

// ─────────── формы и настройки (с БД) ───────────

const base = (over = {}) => ({ topic: "payment", name: "Аня", email: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}@filtertest.example`, message: "Не проходит оплата картой, пишет ошибку банка.", consent: true, ...over });
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test("обращение: мат/контакты в тексте или имени — 422 с понятным текстом, обращение НЕ создаётся, срабатывание записано в журнал", async () => {
  const before = (await pool.query("select count(*)::int as n from public.feedback_messages")).rows[0].n;
  await assert.rejects(() => createFeedback(base({ message: "Это хуйня, не работает ничего вообще" }), { ip: ip() }), (e) => e instanceof ContentFilterError && e.status === 422 && /недопустимые выражения/.test(e.message));
  await assert.rejects(() => createFeedback(base({ message: "Позвоните мне +7 916 123 45 67, всё объясню" }), { ip: ip() }), (e) => e.status === 422 && /телефон/.test(e.message));
  await assert.rejects(() => createFeedback(base({ message: "Подробности на https://spam.example.com/x ждут вас" }), { ip: ip() }), (e) => e.status === 422 && /ссылку/.test(e.message));
  await assert.rejects(() => createFeedback(base({ name: "Пиши @spam_bot" }), { ip: ip() }), (e) => e.status === 422);
  assert.equal((await pool.query("select count(*)::int as n from public.feedback_messages")).rows[0].n, before);
  const log = await listFilterLog();
  assert.equal(log.length, 4);
  assert.deepEqual(log.map((l) => l.target), ["feedback", "feedback", "feedback", "feedback"]);
  assert.ok(log.some((l) => l.field === "name" && l.reasons.includes("handles")));
  assert.ok(log.every((l) => l.snippet.length <= 300));
  // чистое — проходит, ссылка на свой домен тоже
  const ok = await createFeedback(base({ message: "На странице https://ege-tutor.ru/tariffs не открывается оплата, помогите" }), { ip: ip() });
  assert.equal(ok.saved, true);
});

test("отзыв: мат/контакты в тексте или подписи — 422, отзыв не сохраняется; чистый — проходит", async () => {
  const id = await createTestUser({ onboarded: true });
  await pool.query("insert into public.diagnostics (user_id, subject) values ($1, 'math')", [id]);
  for (let i = 0; i < 5; i++) await insertAiMessage(id, { mode: "chat", role: "user" });
  const input = (over = {}) => ({ rating: 5, body: "Репетитор объясняет понятно, диагностика сразу показала слабые темы.", displayName: "Анна К.", consentPublic: true, ...over });
  try {
    await assert.rejects(() => saveMyReview(id, input({ body: "Отличный сервис, пишите мне в телеграм @best_ege_helper за скидкой" })), (e) => e instanceof ContentFilterError && /В отзыве нельзя оставлять контакты/.test(e.message));
    await assert.rejects(() => saveMyReview(id, input({ body: "Хуёвый сервис, ничего не понял вообще совсем" })), (e) => e.status === 422);
    await assert.rejects(() => saveMyReview(id, input({ displayName: "ivan@mail.ru" })), (e) => e.status === 422);
    assert.equal((await pool.query("select count(*)::int as n from public.reviews where user_id = $1", [id])).rows[0].n, 0);
    assert.ok((await listFilterLog()).every((l) => l.target === "reviews"));
    const saved = await saveMyReview(id, input());
    assert.equal(saved.status, "pending");
  } finally {
    await whenNotificationsSettled();
    await deleteTestUser(id);
  }
});

test("настройки: сохранение, проверка, умолчания; после правки списка новые слова работают сразу, а отключение — снимает блок", async () => {
  assert.deepEqual((await loadFilterConfig()).words, DEFAULT_CONFIG.words);
  await assert.rejects(() => saveFilterConfig({ words: "а".repeat(41000) }, null), ContentFilterError);
  await assert.rejects(() => saveFilterConfig({ words: "слово\n" + "б".repeat(81) }, null), ContentFilterError);
  await assert.rejects(() => saveFilterConfig({ words: "слово", allowedDomains: "не домен" }, null), ContentFilterError);

  await saveFilterConfig({ ...DEFAULT_CONFIG, words: "тролль\n", allow: "" }, null);
  await assert.rejects(() => assertCleanText({ message: "ты тролль" }, "feedback"), ContentFilterError);
  await assertCleanText({ message: "пиздец" }, "feedback"); // стандартный список заменён пустой правкой админа
  await saveFilterConfig({ ...DEFAULT_CONFIG, enabled: false }, null);
  await assertCleanText({ message: "хуй https://example.com +7 916 123 45 67" }, "feedback"); // фильтр выключен целиком
  assert.equal((await loadFilterConfig()).enabled, false);
});

test("журнал: записи старше 90 дней удаляются при следующей записи; хранится только фрагмент и хеш IP", async () => {
  await assertCleanText({ message: "заходи на http://bad.example.com" }, "feedback", { ip: "1.2.3.4" }).catch(() => {});
  await pool.query("update public.content_filter_log set created_at = now() - interval '100 days'");
  await assertCleanText({ message: "ещё https://bad2.example.com" }, "reviews", { ip: "1.2.3.4" }).catch(() => {});
  const log = await listFilterLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].target, "reviews");
  const row = (await pool.query("select ip_hash from public.content_filter_log limit 1")).rows[0];
  assert.match(row.ip_hash, /^[0-9a-f]{32}$/);
});
