// Форматированный текст статьи «Базы знаний» — лёгкий аналог TinyMCE на TipTap (npm-пакет, без
// облачного API-ключа и без self-hosted GPL-сборки). Редактор неконтролируемый по value: исходный
// HTML задаётся один раз при монтировании (родитель — AdminBlog.tsx — уже перемонтирует форму через
// key={id} при переключении между статьями, так что синхронизировать value на лету не нужно).
// Итоговый HTML уходит наружу через onChange и рендерится публично в BlogArticle.tsx — там он
// санитизируется через sanitizeArticleHtml (lib/blog.ts) перед dangerouslySetInnerHTML.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import { Icon } from "./ui";

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // не терять фокус/выделение в редакторе перед кликом
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 min-w-8 items-center justify-center rounded-sm border-2 px-1.5 text-[12.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "border-blue bg-blue/10 text-blue" : "border-ink/15 text-ink2 hover:border-ink/35 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ initialValue, onChange }: { initialValue: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }),
      Placeholder.configure({ placeholder: "Текст статьи…" }),
    ],
    content: initialValue,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "article-content min-h-[260px] px-3.5 py-3 text-[13.5px] focus:outline-none" },
    },
  });

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Ссылка (URL) — пусто, чтобы убрать", prev ?? "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="input-blank rounded-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-ink/10 p-1.5">
        <ToolbarButton label="Жирный" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="font-black">Ж</span>
        </ToolbarButton>
        <ToolbarButton label="Курсив" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="italic">К</span>
        </ToolbarButton>
        <ToolbarButton label="Подчёркнутый" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="underline">Ч</span>
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <ToolbarButton label="Заголовок" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolbarButton>
        <ToolbarButton label="Подзаголовок" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <ToolbarButton label="Маркированный список" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <Icon name="list" size={15} />
        </ToolbarButton>
        <ToolbarButton label="Нумерованный список" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolbarButton>
        <ToolbarButton label="Цитата" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Icon name="quote" size={15} />
        </ToolbarButton>
        <ToolbarButton label="Ссылка" active={editor.isActive("link")} onClick={setLink}>
          <Icon name="link" size={15} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <ToolbarButton label="Отменить" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Icon name="arrowL" size={15} />
        </ToolbarButton>
        <ToolbarButton label="Повторить" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Icon name="arrowR" size={15} />
        </ToolbarButton>
        <ToolbarButton label="Убрать форматирование" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
          <Icon name="x" size={15} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
