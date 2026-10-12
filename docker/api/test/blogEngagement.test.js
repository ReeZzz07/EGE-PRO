// Просмотры, лайки, репосты и комментарии под статьями (docker/api/blogEngagement.js, миграция 0044) против
// настоящего локального Postgres. Кто что может: смотреть/лайкать/делиться — любой посетитель (без входа — по
// идентификатору из браузера), писать комментарии — только вошедший.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  COMMENTS_PER_HOUR,
  EngagementError,
  addComment,
  deleteComment,
  getAllStats,
  getAllStatsAdmin,
  getStats,
  listComments,
  listRecentCommentsAdmin,
  publishedArticleId,
  recordShare,
  recordView,
  toggleLike,
  viewerOf,
} from "../blogEngagement.js";
import { ContentFilterError } from "../contentFilter.js";
import { createTestUser, deleteTestUser, pool } from "./helpers.js";

const tag = `eng${randomUUID().slice(0, 8)}`;
const users = [];
const articles = [];

after(async () => {
  for (const id of articles) await pool.query("delete from public.blog_articles where id = $1", [id]);
  for (const id of users) await deleteTestUser(id);
  await pool.end();
});

async function article(published = true) {
  const slug = `${tag}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query("insert into public.blog_articles (slug, title, excerpt, content, is_published) values ($1, $2, 'анонс', '<p>текст</p>', $3) returning id", [slug, `Статья ${slug}`, published]);
  articles.push(rows[0].id);
  return { id: rows[0].id, slug };
}
async function user(name, { admin = false } = {}) {
  const id = await createTestUser({ isAdmin: admin });
  users.push(id);
  await pool.query("update public.profiles set full_name = $2 where id = $1", [id, name]);
  return id;
}
const guest = () => viewerOf({ visitorId: randomUUID() });
const asUser = (id) => viewerOf({ userId: id });

test("viewerOf: вошедший — по аккаунту, гость — по корректному идентификатору браузера, остальное — не посетитель", () => {
  const id = randomUUID();
  assert.deepEqual(viewerOf({ userId: id, visitorId: randomUUID() }), { key: `u:${id}`, userId: id });
  assert.deepEqual(viewerOf({ visitorId: id.toUpperCase() }), { key: `v:${id}`, userId: null });
  assert.equal(viewerOf({ visitorId: "не-uuid" }), null);
  assert.equal(viewerOf({}), null);
});

test("publishedArticleId: только опубликованные; черновик и чужой slug неотличимы", async () => {
  const pub = await article(true);
  const draft = await article(false);
  assert.equal(await publishedArticleId(pub.slug), pub.id);
  assert.equal(await publishedArticleId(draft.slug), null);
  assert.equal(await publishedArticleId("нет-такой"), null);
});

test("просмотры: один на посетителя в день, разные посетители считаются отдельно, у вошедшего и гостя ключи разные", async () => {
  const a = await article();
  const g = guest();
  assert.equal(await recordView(a.id, g), true);
  assert.equal(await recordView(a.id, g), false, "повторный заход в тот же день не считается");
  assert.equal(await recordView(a.id, guest()), true);
  const u = await user("Аня");
  assert.equal(await recordView(a.id, asUser(u)), true);
  assert.equal(await recordView(a.id, asUser(u)), false);
  assert.equal((await getStats(a.id)).views, 3);
  // вчерашний просмотр того же гостя засчитывается заново
  await pool.query("update public.blog_article_views set viewed_on = current_date - 1 where article_id = $1 and viewer_key = $2", [a.id, g.key]);
  assert.equal(await recordView(a.id, g), true);
  assert.equal((await getStats(a.id)).views, 4);
});

test("лайки: ставится и снимается повторным кликом, у каждого посетителя свой; liked в статистике — только у себя", async () => {
  const a = await article();
  const g1 = guest();
  const g2 = guest();
  assert.deepEqual(await toggleLike(a.id, g1), { liked: true, likes: 1 });
  assert.deepEqual(await toggleLike(a.id, g2), { liked: true, likes: 2 });
  assert.equal((await getStats(a.id, g1)).liked, true);
  assert.equal((await getStats(a.id, guest())).liked, false);
  assert.equal((await getStats(a.id)).liked, false, "без посетителя лайка «моего» нет");
  assert.deepEqual(await toggleLike(a.id, g1), { liked: false, likes: 1 });
  assert.equal((await getStats(a.id, g1)).liked, false);
});

test("репосты: один на посетителя, канал и день; «скопировать ссылку» в публичный счётчик не входит; неизвестный канал — ошибка", async () => {
  const a = await article();
  const g = guest();
  assert.equal(await recordShare(a.id, g, "vk"), true);
  assert.equal(await recordShare(a.id, g, "vk"), false, "тот же канал в тот же день не удваивается");
  assert.equal(await recordShare(a.id, g, "telegram"), true, "другой канал — отдельный репост");
  assert.equal(await recordShare(a.id, guest(), "whatsapp"), true);
  assert.equal(await recordShare(a.id, guest(), "ok"), true);
  assert.equal(await recordShare(a.id, g, "copy"), true);
  assert.equal((await getStats(a.id)).shares, 4);
  await assert.rejects(recordShare(a.id, g, "facebook"), (e) => e instanceof EngagementError && /Неизвестный способ/.test(e.message));
});

test("комментарии: пишет только вошедший; длина 2–2000; новые сверху; автор — только имя, у админа подпись редакции; «mine» только у своих", async () => {
  const a = await article();
  const u = await user("Мария Иванова");
  const admin = await user("Главный Редактор", { admin: true });
  await assert.rejects(addComment(a.id, null, "Привет"), (e) => e.status === 401);
  await assert.rejects(addComment(a.id, u, "я"), /слишком короткий/);
  await assert.rejects(addComment(a.id, u, "ж".repeat(2001)), /слишком длинный/);

  const c1 = await addComment(a.id, u, "  Спасибо за статью!  ");
  assert.equal(c1.body, "Спасибо за статью!");
  assert.equal(c1.author, "Мария", "фамилия не показывается");
  assert.equal(c1.mine, true);
  assert.equal(c1.staff, false);
  const c2 = await addComment(a.id, admin, "Рады, что пригодилось");
  assert.equal(c2.author, "Редакция ЕГЭ·ПРО");
  assert.equal(c2.staff, true);

  const list = await listComments(a.id, { me: u });
  assert.deepEqual(list.comments.map((c) => c.body), ["Рады, что пригодилось", "Спасибо за статью!"], "новые сверху");
  assert.equal(list.comments.find((c) => c.body === "Спасибо за статью!").mine, true);
  assert.equal(list.comments.find((c) => c.staff).mine, false);
  const anon = await listComments(a.id);
  assert.ok(anon.comments.every((c) => c.mine === false), "гость читает, но «своих» у него нет");
  assert.equal((await getStats(a.id)).comments, 2);
});

test("комментарии: без имени — «Ученик»; тот же текст под той же статьёй за сутки не принимается; не больше пяти в час", async () => {
  const a = await article();
  const noName = await user("");
  const c = await addComment(a.id, noName, "Первый!");
  assert.equal(c.author, "Ученик");
  await assert.rejects(addComment(a.id, noName, "Первый!"), /уже оставлял/);
  for (let i = 2; i <= COMMENTS_PER_HOUR; i++) await addComment(a.id, noName, `Комментарий номер ${i}`);
  await assert.rejects(addComment(a.id, noName, "Лишний комментарий"), (e) => e.status === 429 && /Слишком много/.test(e.message));
});

test("комментарии: ссылки, контакты и запрещённые выражения отсекаются тем же фильтром, что у отзывов (цель «comments»)", async () => {
  const a = await article();
  const u = await user("Фильтр");
  await assert.rejects(addComment(a.id, u, "Смотрите https://spam.example.com/win"), (e) => e instanceof ContentFilterError && /ссылк/.test(e.message) && /В комментарии/.test(e.message));
  await assert.rejects(addComment(a.id, u, "Звоните +7 916 123 45 67 срочно"), (e) => e instanceof ContentFilterError);
  assert.equal((await getStats(a.id)).comments, 0, "отклонённое не сохраняется");
});

test("комментарии: постраничная выдача с курсором (30 на страницу)", async () => {
  const a = await article();
  const u = await user("Много");
  for (let i = 1; i <= 7; i++) await pool.query("insert into public.blog_comments (article_id, user_id, body) values ($1, $2, $3)", [a.id, u, `текст ${i}`]);
  const p1 = await listComments(a.id, { limit: 3 });
  assert.deepEqual(p1.comments.map((c) => c.body), ["текст 7", "текст 6", "текст 5"]);
  assert.ok(p1.nextBeforeId);
  const p2 = await listComments(a.id, { limit: 3, beforeId: p1.nextBeforeId });
  assert.deepEqual(p2.comments.map((c) => c.body), ["текст 4", "текст 3", "текст 2"]);
  const p3 = await listComments(a.id, { limit: 3, beforeId: p2.nextBeforeId });
  assert.deepEqual(p3.comments.map((c) => c.body), ["текст 1"]);
  assert.equal(p3.nextBeforeId, null);
});

test("удаление: свой комментарий — автор, чужой — нельзя, любой — админ", async () => {
  const a = await article();
  const author = await user("Автор");
  const other = await user("Чужой");
  const admin = await user("Админ", { admin: true });
  const c1 = await addComment(a.id, author, "Мой комментарий");
  assert.equal(await deleteComment(c1.id, { userId: other, isAdmin: false }), false);
  assert.equal(await deleteComment(c1.id, { userId: author, isAdmin: false }), true);
  const c2 = await addComment(a.id, author, "Для модерации");
  assert.equal(await deleteComment(c2.id, { userId: admin, isAdmin: true }), true);
  assert.equal(await deleteComment("не число", { userId: admin, isAdmin: true }), false);
  assert.equal((await getStats(a.id)).comments, 0);
});

test("списки статистики: публичный — по slug только опубликованных, админский — по id включая черновики; последние комментарии для модерации", async () => {
  const pub = await article(true);
  const draft = await article(false);
  const u = await user("Для списка");
  await toggleLike(pub.id, guest());
  await recordView(pub.id, guest());
  await pool.query("insert into public.blog_comments (article_id, user_id, body) values ($1, $2, 'в черновике')", [draft.id, u]);
  const all = await getAllStats();
  assert.deepEqual(all[pub.slug], { views: 1, likes: 1, shares: 0, comments: 0 });
  assert.equal(all[draft.slug], undefined, "черновика в публичном списке нет");
  const admin = await getAllStatsAdmin();
  assert.equal(admin[draft.id].comments, 1);
  assert.equal(admin[pub.id].views, 1);
  const recent = await listRecentCommentsAdmin(200);
  const mine = recent.find((c) => c.articleSlug === draft.slug);
  assert.equal(mine.body, "в черновике");
  assert.equal(mine.articleTitle, `Статья ${draft.slug}`);
  assert.ok(mine.email.includes("@"));
});

test("удаление аккаунта убирает его комментарии, лайки, просмотры и репосты; чужие остаются", async () => {
  const a = await article();
  const leaving = await user("Уходящий");
  const staying = await user("Остающийся");
  for (const id of [leaving, staying]) {
    await recordView(a.id, asUser(id));
    await toggleLike(a.id, asUser(id));
    await recordShare(a.id, asUser(id), "vk");
    await addComment(a.id, id, `Комментарий ${id}`);
  }
  assert.deepEqual(await getStats(a.id), { views: 2, likes: 2, shares: 2, comments: 2, liked: false });
  await deleteTestUser(leaving);
  assert.deepEqual(await getStats(a.id), { views: 1, likes: 1, shares: 1, comments: 1, liked: false });
});
