// Отложенная публикация статей (docker/api/blogScheduler.js) против настоящего Postgres —
// только SQL-условие тикера, без HTTP-слоя (planScheduler сам по себе не имеет роута).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { publishScheduledArticles } from "../blogScheduler.js";
import { pool } from "./helpers.js";

after(() => pool.end());

async function insertArticle({ isPublished = false, scheduledAt = null, publishedAt = null } = {}) {
  const slug = `test-${randomUUID()}`;
  const { rows } = await pool.query(
    `insert into public.blog_articles (slug, title, excerpt, content, is_published, scheduled_at, published_at)
     values ($1, $2, 'excerpt', 'content', $3, $4, $5) returning id`,
    [slug, slug, isPublished, scheduledAt, publishedAt]
  );
  return { id: rows[0].id, slug };
}

async function deleteArticle(id) {
  await pool.query("delete from public.blog_articles where id = $1", [id]);
}

async function loadArticle(id) {
  const { rows } = await pool.query("select is_published, published_at, scheduled_at from public.blog_articles where id = $1", [id]);
  return rows[0];
}

test("черновик с наступившим временем публикации — публикуется, published_at = scheduled_at", async () => {
  const scheduledAt = new Date(Date.now() - 60 * 1000);
  const a = await insertArticle({ scheduledAt });
  try {
    const count = await publishScheduledArticles();
    assert.ok(count >= 1);
    const row = await loadArticle(a.id);
    assert.equal(row.is_published, true);
    assert.equal(row.scheduled_at, null);
    assert.equal(new Date(row.published_at).getTime(), scheduledAt.getTime());
  } finally {
    await deleteArticle(a.id);
  }
});

test("черновик со временем публикации в будущем — не трогается", async () => {
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
  const a = await insertArticle({ scheduledAt });
  try {
    await publishScheduledArticles();
    const row = await loadArticle(a.id);
    assert.equal(row.is_published, false);
    assert.equal(new Date(row.scheduled_at).getTime(), scheduledAt.getTime());
  } finally {
    await deleteArticle(a.id);
  }
});

test("черновик без scheduled_at — не трогается", async () => {
  const a = await insertArticle();
  try {
    await publishScheduledArticles();
    const row = await loadArticle(a.id);
    assert.equal(row.is_published, false);
    assert.equal(row.scheduled_at, null);
  } finally {
    await deleteArticle(a.id);
  }
});

test("уже опубликованная статья с scheduled_at (не должно бывать штатно) — не трогается повторно", async () => {
  const scheduledAt = new Date(Date.now() - 60 * 1000);
  const publishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const a = await insertArticle({ isPublished: true, scheduledAt, publishedAt });
  try {
    await publishScheduledArticles();
    const row = await loadArticle(a.id);
    assert.equal(row.is_published, true);
    assert.equal(new Date(row.published_at).getTime(), publishedAt.getTime());
  } finally {
    await deleteArticle(a.id);
  }
});
