// CRUD статей «Базы знаний» (public.blog_articles) — видно только админу (RLS в
// supabase/migrations/0032_blog_articles.sql). Публикация — отдельное действие от сохранения:
// publishArticle сама решает, ставить ли published_at (только при первой публикации, см. lib/blog.ts).
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  createArticle,
  deleteArticle,
  loadAllArticlesAdmin,
  publishArticle,
  slugify,
  unpublishArticle,
  updateArticle,
  uploadBlogCoverImage,
  type BlogArticle,
  type BlogArticleInput,
} from "../lib/blog";
import { Icon, useToast } from "./ui";

const EMPTY_FORM: BlogArticleInput = { title: "", slug: "", excerpt: "", content: "", coverImage: null, isPinned: false, visibleToGuests: true };

function ArticleForm({
  initial,
  isNew,
  onCancel,
  onSave,
  saving,
}: {
  initial: BlogArticleInput;
  isNew: boolean;
  onCancel: () => void;
  onSave: (v: BlogArticleInput) => void;
  saving: boolean;
}) {
  const { push } = useToast();
  const [form, setForm] = useState<BlogArticleInput>(initial);
  // Пока slug не тронут руками — авто-подставляем его из заголовка. Для новой статьи начинаем
  // с "не тронут"; для уже существующей slug осмысленный (это её URL) — трогать не начинаем.
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onUploadCover = async (file: File) => {
    setUploading(true);
    const res = await uploadBlogCoverImage(file);
    setUploading(false);
    if (res.error) return push(res.error, "err");
    setForm((f) => ({ ...f, coverImage: res.url! }));
  };

  return (
    <div className="border-2 border-dashed border-ink/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Заголовок</span>
          <input
            value={form.title}
            onChange={(e) => {
              const title = e.target.value;
              setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : slugify(title) }));
            }}
            placeholder="ИИ-репетитор vs живой репетитор: что выбрать"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">URL (slug) — /blog/…</span>
          <input
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setForm((f) => ({ ...f, slug: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") }));
            }}
            placeholder="ii-repetitor-vs-zhivoi-repetitor"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Краткое описание (в карточках и списке)</span>
          <textarea
            value={form.excerpt}
            onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
            rows={2}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Текст статьи (обычный текст, абзацы — пустой строкой)</span>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={10}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13.5px]"
          />
        </label>
        <div className="sm:col-span-2">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Обложка (необязательно)</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
              <Icon name="upload" size={14} /> {uploading ? "Загружаем…" : "Загрузить файл"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadCover(f);
                e.target.value = "";
              }}
            />
            {form.coverImage && (
              <>
                <img src={form.coverImage} alt="" className="h-9 w-16 rounded-sm border-2 border-ink/15 object-cover" />
                <button type="button" onClick={() => setForm((f) => ({ ...f, coverImage: null }))} className="btn btn-ghost px-2.5 py-2 text-[11px]">
                  <Icon name="trash" size={13} /> Убрать
                </button>
              </>
            )}
          </div>
        </div>
        <label className="mt-1 flex items-center gap-2">
          <input type="checkbox" checked={form.isPinned} onChange={(e) => setForm((f) => ({ ...f, isPinned: e.target.checked }))} className="h-4 w-4" />
          <span className="text-[13px] font-bold">📌 Закрепить (показывать первой в разделе «последние статьи»)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.visibleToGuests} onChange={(e) => setForm((f) => ({ ...f, visibleToGuests: e.target.checked }))} className="h-4 w-4" />
          <span className="text-[13px] font-bold">Видна незарегистрированным (гостям). Выключено — только для вошедших в аккаунт.</span>
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.title.trim() || !form.slug.trim() || !form.excerpt.trim() || !form.content.trim()}
          className="btn btn-blue px-4 py-2 text-[12.5px] disabled:opacity-50"
        >
          <Icon name="check" size={13} /> {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        <button onClick={onCancel} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function AdminBlog() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [articles, setArticles] = useState<BlogArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = () => loadAllArticlesAdmin().then((a) => { setArticles(a); setLoading(false); });
  useEffect(() => { refresh(); }, []);

  const saveEdit = async (id: string, v: BlogArticleInput) => {
    setSaving(true);
    const res = await updateArticle(id, v);
    setSaving(false);
    if (res.error) { push(res.error, "err"); return; }
    push("Статья обновлена", "ok");
    setEditingId(null);
    refresh();
  };

  const saveNew = async (v: BlogArticleInput) => {
    if (!profile) return;
    setSaving(true);
    const res = await createArticle(v, profile.id);
    setSaving(false);
    if (res.error) { push(res.error, "err"); return; }
    push("Статья создана (черновик)", "ok");
    setAddingNew(false);
    refresh();
  };

  const togglePublish = async (a: BlogArticle) => {
    const res = a.isPublished ? await unpublishArticle(a.id) : await publishArticle(a.id, a.publishedAt);
    if (res.error) { push(res.error, "err"); return; }
    push(a.isPublished ? "Снято с публикации" : "Опубликовано", "ok");
    refresh();
  };

  const remove = async (id: string) => {
    const res = await deleteArticle(id);
    if (res.error) { push(res.error, "err"); return; }
    push("Статья удалена", "ok");
    refresh();
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">База знаний</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Статьи-советы и разборы — видны на /blog и в разделе «последние статьи» на главной/дашборде только после публикации.
        Закреплённые статьи показываются первыми.
      </p>

      <div className="mt-5 space-y-3">
        {articles.map((a) =>
          editingId === a.id ? (
            <ArticleForm
              key={a.id}
              initial={{ title: a.title, slug: a.slug, excerpt: a.excerpt, content: a.content, coverImage: a.coverImage, isPinned: a.isPinned, visibleToGuests: a.visibleToGuests }}
              isNew={false}
              saving={saving}
              onCancel={() => setEditingId(null)}
              onSave={(v) => saveEdit(a.id, v)}
            />
          ) : (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/15 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[15px] font-bold">{a.title}</span>
                  <span className={`rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${a.isPublished ? "border-green/40 bg-green/10 text-green" : "border-ink/20 text-ink2"}`}>
                    {a.isPublished ? "опубликовано" : "черновик"}
                  </span>
                  {a.isPinned && <span className="font-mono text-[11px]">📌</span>}
                  {!a.visibleToGuests && (
                    <span className="rounded-sm border-2 border-ink/20 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-ink2">только для вошедших</span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-ink2">
                  /blog/{a.slug} {a.publishedAt && `· ${new Date(a.publishedAt).toLocaleDateString("ru-RU")}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => togglePublish(a)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  <Icon name={a.isPublished ? "eyeOff" : "check"} size={13} /> {a.isPublished ? "Снять с публикации" : "Опубликовать"}
                </button>
                <button onClick={() => setEditingId(a.id)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  <Icon name="refresh" size={13} /> Редактировать
                </button>
                <button onClick={() => remove(a.id)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  <Icon name="trash" size={13} /> Удалить
                </button>
              </div>
            </div>
          )
        )}
        {articles.length === 0 && <p className="text-[13px] text-ink2">Статей пока нет.</p>}
      </div>

      <div className="mt-4">
        {addingNew ? (
          <ArticleForm initial={EMPTY_FORM} isNew saving={saving} onCancel={() => setAddingNew(false)} onSave={saveNew} />
        ) : (
          <button onClick={() => setAddingNew(true)} className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]">
            + Новая статья
          </button>
        )}
      </div>
    </div>
  );
}
