// «Попросить родителя оплатить» (docker/api/parentPay.js): ссылка, публичный вид, лимиты писем, статистика.
// Гоняется против локального Postgres (см. helpers.js); сам платёж ЮKassa и отправка почты не вызываются
// (до них доходит только проверка входных данных и лимитов).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateLink,
  recordShare,
  getPublicView,
  getParentPaymentStatus,
  startParentPayment,
  sendParentEmail,
  buildParentEmail,
  getParentPayStats,
  getLinkStatus,
  findParentWaitingCandidates,
  diagnosticSummary,
  normalizePlace,
  REMIND_AFTER_HOURS,
  firstName,
  isValidToken,
  linkUrl,
} from "../parentPay.js";
import { createTestUser, deleteTestUser, sweepLeftoverTestUsers, createTestPayment, pool } from "./helpers.js";

before(sweepLeftoverTestUsers);
after(async () => {
  await sweepLeftoverTestUsers();
  await pool.end();
});

test("firstName / isValidToken / linkUrl: мелкие помощники", () => {
  assert.equal(firstName("Анна Петрова"), "Анна");
  assert.equal(firstName("  "), null);
  assert.equal(firstName(null), null);
  assert.equal(isValidToken("abc"), false);
  assert.equal(isValidToken("x".repeat(32)), true);
  assert.equal(isValidToken("x/../".repeat(8)), false);
  assert.equal(linkUrl("https://ege-tutor.ru", "tok"), "https://ege-tutor.ru/pay-for/tok");
});

test("getOrCreateLink: одна живая ссылка на ученика — повторный вызов даёт ту же, событие «создана» пишется один раз", async () => {
  const userId = await createTestUser();
  try {
    const a = await getOrCreateLink(userId);
    const b = await getOrCreateLink(userId);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.token, b.token);
    assert.ok(isValidToken(a.token));
    const { rows } = await pool.query("select count(*)::int as n from public.parent_link_events where link_id = $1 and kind = 'created'", [a.id]);
    assert.equal(rows[0].n, 1);
  } finally {
    await deleteTestUser(userId);
  }
});

test("getPublicView: имя, счётчики и платные тарифы с итоговой ценой; чужой токен — null; истёкшая — expired", async () => {
  const userId = await createTestUser();
  try {
    await pool.query("update public.profiles set full_name = 'Мария Иванова', discount_percent = 10 where id = $1", [userId]);
    const link = await getOrCreateLink(userId);
    const view = await getPublicView(link.token);
    assert.equal(view.expired, false);
    assert.equal(view.studentName, "Мария");
    assert.equal(view.tasksSolved, 0);
    assert.equal(view.diagnosticDone, false);
    assert.ok(view.tariffs.length > 0);
    assert.ok(view.tariffs.every((t) => t.finalPrice > 0 && t.finalPrice <= t.basePrice));
    assert.equal(view.discountPercent, 10);
    const att = view.tariffs.find((t) => t.id === "attestat");
    if (att) assert.equal(att.finalPrice, Math.round(att.basePrice * 0.9 * 100) / 100);

    assert.equal(await getPublicView("z".repeat(32)), null);
    assert.equal(await getPublicView("короткий"), null);

    await pool.query("update public.parent_links set expires_at = now() - interval '1 minute' where id = $1", [link.id]);
    assert.deepEqual(await getPublicView(link.token), { expired: true });
  } finally {
    await deleteTestUser(userId);
  }
});

test("getPublicView: открытие пишется в журнал не чаще раза в полчаса", async () => {
  const userId = await createTestUser();
  try {
    const link = await getOrCreateLink(userId);
    await getPublicView(link.token);
    await getPublicView(link.token);
    const { rows } = await pool.query("select count(*)::int as n from public.parent_link_events where link_id = $1 and kind = 'opened'", [link.id]);
    assert.equal(rows[0].n, 1);
  } finally {
    await deleteTestUser(userId);
  }
});

test("анонимизированный ученик: ссылка перестаёт работать", async () => {
  const userId = await createTestUser();
  try {
    const link = await getOrCreateLink(userId);
    await pool.query("update public.profiles set anonymized_at = now() where id = $1", [userId]);
    assert.equal(await getPublicView(link.token), null);
  } finally {
    await deleteTestUser(userId);
  }
});

test("startParentPayment: неверная ссылка, истёкшая ссылка и плохой email отсекаются до обращения к ЮKassa", async () => {
  const userId = await createTestUser();
  try {
    const link = await getOrCreateLink(userId);
    assert.match((await startParentPayment("z".repeat(32), { tariffId: "attestat", email: "mama@mail.ru" }, "https://x.test")).error, /не найдена/);
    assert.match((await startParentPayment(link.token, { tariffId: "attestat", email: "мама@почта.рф" }, "https://x.test")).error, /латиницей/);
    assert.match((await startParentPayment(link.token, { tariffId: "attestat", email: "bad" }, "https://x.test")).error, /email/i);
    await pool.query("update public.parent_links set expires_at = now() - interval '1 minute' where id = $1", [link.id]);
    assert.match((await startParentPayment(link.token, { tariffId: "attestat", email: "mama@mail.ru" }, "https://x.test")).error, /истёк/);
    const { rows } = await pool.query("select count(*)::int as n from public.payments where user_id = $1", [userId]);
    assert.equal(rows[0].n, 0, "платёж не создаётся");
  } finally {
    await deleteTestUser(userId);
  }
});

test("getParentPaymentStatus: платёж виден только по ссылке, к которой он привязан", async () => {
  const a = await createTestUser();
  const b = await createTestUser();
  try {
    const linkA = await getOrCreateLink(a);
    const linkB = await getOrCreateLink(b);
    const payId = await createTestPayment(a, { status: "succeeded" });
    await pool.query("update public.payments set parent_link_id = $2 where id = $1", [payId, linkA.id]);
    const ok = await getParentPaymentStatus(linkA.token, payId);
    assert.equal(ok.status, "succeeded");
    assert.equal(ok.amountRub, 1990);
    assert.equal(await getParentPaymentStatus(linkB.token, payId), null, "чужая ссылка не читает чужой платёж");
    assert.equal(await getParentPaymentStatus("z".repeat(32), payId), null);
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
  }
});

test("sendParentEmail: плохой адрес, собственный адрес, час между письмами, три в сутки, три на адрес", async () => {
  const userId = await createTestUser();
  const other = await createTestUser();
  try {
    assert.match((await sendParentEmail(userId, "мама@почта.рф", "https://x.test")).error, /латиницей/);
    const own = (await pool.query("select email from auth.users where id = $1", [userId])).rows[0].email;
    assert.match((await sendParentEmail(userId, own, "https://x.test")).error, /собственный/);

    // письмо только что отправлено → пауза
    const crypto = await import("node:crypto");
    const h = crypto.createHash("sha256").update("mama@mail.ru").digest("hex");
    await pool.query("insert into public.parent_email_log (user_id, email_hash, sent_at) values ($1, $2, now() - interval '10 minutes')", [userId, h]);
    assert.match((await sendParentEmail(userId, "papa@mail.ru", "https://x.test")).error, /подожди час/);

    // три письма за сутки, но давно (> часа) → лимит суток
    await pool.query("update public.parent_email_log set sent_at = now() - interval '3 hours' where user_id = $1", [userId]);
    for (let i = 0; i < 2; i++) await pool.query("insert into public.parent_email_log (user_id, email_hash, sent_at) values ($1, $2, now() - interval '2 hours')", [userId, `h${i}`]);
    assert.match((await sendParentEmail(userId, "papa@mail.ru", "https://x.test")).error, /три письма/);

    // три письма на один адрес от разных учеников
    for (let i = 0; i < 3; i++) await pool.query("insert into public.parent_email_log (user_id, email_hash, sent_at) values ($1, $2, now() - interval '3 days')", [other, h]);
    assert.match((await sendParentEmail(other, "mama@mail.ru", "https://x.test")).error, /уже отправляли/);
  } finally {
    await deleteTestUser(userId);
    await deleteTestUser(other);
  }
});

test("buildParentEmail: имя, прогресс, ссылка в кнопке и текстом, срок и способ отказа; без имени и прогресса — тоже работает", () => {
  const url = "https://ege-tutor.ru/pay-for/abc";
  const m = buildParentEmail({ studentName: "Анна", url, stats: { tasksSolved: 5, diagnosticDone: true }, siteUrl: "https://ege-tutor.ru" });
  assert.match(m.subject, /Анна просит/);
  assert.ok(m.html.includes(`href="${url}"`));
  assert.ok(m.text.includes(url));
  assert.match(m.text, /решено 5 заданий/);
  assert.match(m.text, /диагностика/);
  assert.match(m.text, /«стоп»/);
  assert.match(m.text, /14 дней/);
  assert.match(m.text, /СБП/);
  const plain = buildParentEmail({ studentName: null, url, stats: { tasksSolved: 0, diagnosticDone: false }, siteUrl: "https://ege-tutor.ru" });
  assert.match(plain.subject, /Ваш ребёнок/);
  assert.ok(!/Уже сделано/.test(plain.text));
  const one = buildParentEmail({ studentName: "Лев", url: "https://x/\"><script>", stats: { tasksSolved: 1 }, siteUrl: "https://x" });
  assert.ok(!one.html.includes('"><script>'), "ссылка экранируется");
  assert.match(one.text, /решено 1 задание/);
});

test("getParentPayStats: считает созданные, поделились по каналам, открытия, начатые и проведённые платежи", async () => {
  const userId = await createTestUser();
  try {
    const before = await getParentPayStats();
    const link = await getOrCreateLink(userId);
    await recordShare(userId, "whatsapp");
    await recordShare(userId, "copy");
    await recordShare(userId, "ерунда"); // неизвестный канал → other, в отдельные счётчики не попадает
    await getPublicView(link.token);
    const payId = await createTestPayment(userId, { status: "succeeded", amountRub: 2793 });
    await pool.query("update public.payments set parent_link_id = $2 where id = $1", [payId, link.id]);
    const after = await getParentPayStats();
    assert.equal(after.created - before.created, 1);
    assert.equal(after.shared - before.shared, 1, "ссылок, которыми поделились, — по уникальным ссылкам");
    assert.equal(after.shared_whatsapp - before.shared_whatsapp, 1);
    assert.equal(after.shared_copy - before.shared_copy, 1);
    assert.equal(after.opened - before.opened, 1);
    assert.equal(after.paid - before.paid, 1);
    assert.equal(after.revenue - before.revenue, 2793);
  } finally {
    await deleteTestUser(userId);
  }
});

test("normalizePlace: известные места как есть, «paywall:…» сводится к paywall, незнакомое — other, пусто — null", () => {
  assert.equal(normalizePlace("ai-limit"), "ai-limit");
  assert.equal(normalizePlace("diagnostic-result"), "diagnostic-result");
  assert.equal(normalizePlace("paywall:Чтобы план не упёрся в лимит"), "paywall");
  assert.equal(normalizePlace("  TARIFFS "), "tariffs");
  assert.equal(normalizePlace("что-то-новое"), "other");
  assert.equal(normalizePlace(""), null);
  assert.equal(normalizePlace(undefined), null);
});

test("getOrCreateLink с местом: «запросил» пишется по месту, повтор того же места за 10 минут не считается, без места — не пишется", async () => {
  const userId = await createTestUser();
  try {
    const first = await getOrCreateLink(userId); // без места: например, пересылка из recordShare
    const count = async (place) => (await pool.query("select count(*)::int as n from public.parent_link_events where link_id = $1 and kind = 'requested' and place = $2", [first.id, place])).rows[0].n;
    assert.equal((await pool.query("select count(*)::int as n from public.parent_link_events where link_id = $1 and kind = 'requested'", [first.id])).rows[0].n, 0);
    await getOrCreateLink(userId, "ai-limit");
    await getOrCreateLink(userId, "ai-limit");
    await getOrCreateLink(userId, "diagnostic-result");
    await getOrCreateLink(userId, "paywall:Любая подпись");
    await getOrCreateLink(userId, "выдумка");
    assert.equal(await count("ai-limit"), 1);
    assert.equal(await count("diagnostic-result"), 1);
    assert.equal(await count("paywall"), 1);
    assert.equal(await count("other"), 1);
    // через 10 минут то же место считается заново
    await pool.query("update public.parent_link_events set created_at = now() - interval '11 minutes' where link_id = $1 and kind = 'requested' and place = 'ai-limit'", [first.id]);
    await getOrCreateLink(userId, "ai-limit");
    assert.equal(await count("ai-limit"), 2);
  } finally {
    await deleteTestUser(userId);
  }
});

test("diagnosticSummary: только безопасное для родителя — уровень из списка, числа, до трёх слабых тем; мусор отбрасывается", () => {
  assert.equal(diagnosticSummary(null), null);
  assert.deepEqual(diagnosticSummary({ subject: "math", result: { level: "mid", estimatedScoreMin: 52.4, estimatedScoreMax: 68, weakTopics: ["производная", "стереометрия", "логарифмы", "вероятность"], strongTopics: ["секрет"] } }), {
    subject: "math",
    subjectName: "Математика (профиль)",
    level: "mid",
    scoreMin: 52,
    scoreMax: 68,
    weakTopics: ["производная", "стереометрия", "логарифмы"],
  });
  assert.deepEqual(diagnosticSummary({ subject: "rus", result: { level: "сверхразум", estimatedScoreMin: "abc", weakTopics: [1, "", "  ", { x: 1 }] } }), { subject: "rus", subjectName: "Русский язык", level: null, scoreMin: null, scoreMax: null, weakTopics: [] });
  assert.deepEqual(diagnosticSummary({ subject: "rus", result: null }), { subject: "rus", subjectName: "Русский язык", level: null, scoreMin: null, scoreMax: null, weakTopics: [] });
});

test("getPublicView: родитель видит итог последней диагностики ребёнка, а ответы и сильные темы — нет", async () => {
  const userId = await createTestUser();
  try {
    await pool.query("insert into public.diagnostics (user_id, subject, answers, result, finished_at) values ($1, 'math', '[]', $2, now() - interval '2 days')", [
      userId,
      JSON.stringify({ level: "low", estimatedScoreMin: 20, estimatedScoreMax: 30, weakTopics: ["старая тема"] }),
    ]);
    await pool.query("insert into public.diagnostics (user_id, subject, answers, result) values ($1, 'rus', '[{\"секрет\":1}]', $2)", [
      userId,
      JSON.stringify({ level: "mid", estimatedScoreMin: 50, estimatedScoreMax: 64, weakTopics: ["пунктуация", "орфография"], strongTopics: ["секрет"] }),
    ]);
    const link = await getOrCreateLink(userId);
    const view = await getPublicView(link.token);
    assert.equal(view.diagnosticDone, true);
    assert.deepEqual(view.diagnostic, { subject: "rus", subjectName: "Русский язык", level: "mid", scoreMin: 50, scoreMax: 64, weakTopics: ["пунктуация", "орфография"] });
    assert.ok(!JSON.stringify(view).includes("секрет"));
  } finally {
    await deleteTestUser(userId);
  }
});

test("getLinkStatus: none → sent → waiting (через сутки без открытия) → opened → paid", async () => {
  const userId = await createTestUser();
  try {
    assert.equal((await getLinkStatus(userId)).state, "none");
    const link = await getOrCreateLink(userId);
    assert.equal((await getLinkStatus(userId)).state, "none", "ссылку создали, но не отправили");
    await recordShare(userId, "whatsapp");
    assert.equal((await getLinkStatus(userId)).state, "sent");
    await pool.query("update public.parent_link_events set created_at = now() - make_interval(hours => $2) where link_id = $1 and kind = 'shared'", [link.id, REMIND_AFTER_HOURS + 1]);
    const waiting = await getLinkStatus(userId);
    assert.equal(waiting.state, "waiting");
    assert.ok(waiting.sentAt && waiting.expiresAt);
    await getPublicView(link.token);
    assert.equal((await getLinkStatus(userId)).state, "opened");
    const payId = await createTestPayment(userId, { status: "succeeded" });
    await pool.query("update public.payments set parent_link_id = $2 where id = $1", [payId, link.id]);
    assert.equal((await getLinkStatus(userId)).state, "paid");
  } finally {
    await deleteTestUser(userId);
  }
});

test("findParentWaitingCandidates: отправил 24–72 часа назад, не открыли, тариф free, почта подтверждена — и только один раз", async () => {
  const userId = await createTestUser();
  const ids = () => findParentWaitingCandidates(500).then((rows) => rows.map((r) => r.id));
  const backdate = (link, hours) => pool.query("update public.parent_link_events set created_at = now() - make_interval(hours => $2) where link_id = $1 and kind = 'shared'", [link.id, hours]);
  try {
    await pool.query("update auth.users set email_confirmed_at = now() where id = $1", [userId]);
    const link = await getOrCreateLink(userId);
    await recordShare(userId, "telegram");
    assert.ok(!(await ids()).includes(userId), "отправлено только что — рано");
    await backdate(link, 30);
    assert.ok((await ids()).includes(userId));
    await backdate(link, 100);
    assert.ok(!(await ids()).includes(userId), "прошло больше трёх суток — поздно");
    await backdate(link, 30);

    await pool.query("update public.profiles set tariff_id = 'attestat' where id = $1", [userId]);
    assert.ok(!(await ids()).includes(userId), "тариф уже платный");
    await pool.query("update public.profiles set tariff_id = 'free' where id = $1", [userId]);
    assert.ok((await ids()).includes(userId));

    await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, 'parent_waiting')", [userId]);
    assert.ok(!(await ids()).includes(userId), "напоминание уже отправлялось");
    await pool.query("delete from public.lifecycle_emails where user_id = $1", [userId]);

    await getPublicView(link.token);
    assert.ok(!(await ids()).includes(userId), "родитель открыл ссылку");
  } finally {
    await deleteTestUser(userId);
  }
});

test("getParentPayStats: разбивка по местам (запросили → открыли → оплатили) и число напоминаний", async () => {
  const a = await createTestUser();
  const b = await createTestUser();
  try {
    const before = await getParentPayStats();
    const get = (st, place) => st.places.find((x) => x.place === place) ?? { requested: 0, opened: 0, paid: 0 };
    const linkA = await getOrCreateLink(a, "ai-limit");
    const linkB = await getOrCreateLink(b, "ai-limit");
    await getOrCreateLink(b, "diagnostic-result");
    await getPublicView(linkA.token);
    const payId = await createTestPayment(a, { status: "succeeded", amountRub: 1990 });
    await pool.query("update public.payments set parent_link_id = $2 where id = $1", [payId, linkA.id]);
    await pool.query("insert into public.lifecycle_emails (user_id, kind) values ($1, 'parent_waiting')", [b]);
    const after = await getParentPayStats();
    assert.equal(get(after, "ai-limit").requested - get(before, "ai-limit").requested, 2);
    assert.equal(get(after, "ai-limit").opened - get(before, "ai-limit").opened, 1);
    assert.equal(get(after, "ai-limit").paid - get(before, "ai-limit").paid, 1);
    assert.equal(get(after, "diagnostic-result").requested - get(before, "diagnostic-result").requested, 1);
    assert.equal(get(after, "diagnostic-result").opened - get(before, "diagnostic-result").opened, 0);
    assert.equal(after.reminders - before.reminders, 1);
    assert.ok(linkB.id);
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
  }
});
