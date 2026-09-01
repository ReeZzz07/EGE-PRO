// Иллюстрации к заданию для мультимодального промпта ИИ-репетитора.
//
// Почти все SVG в банке (~54% всех вложений) — не картинки-фотографии, а рендер формул сервисом
// Wiris: у них в комментарии внутри самого SVG зашит исходный MathML (`<!--MathML: ...-->`).
// Модель прекрасно читает MathML как текст — отправлять их через vision (в разы дороже и без
// выигрыша в точности для формулы из трёх символов) смысла нет, просто разворачиваем в текст.
// Растровые файлы (графики, карты, схемы — то, что реально нужно "увидеть") идут в vision,
// если провайдер/модель это умеют — см. supportsVision().
import fs from "node:fs";
import path from "node:path";

const STORAGE_ROOT = process.env.STORAGE_ROOT || "/data/storage";

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function sniffMime(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  const ascii6 = buf.toString("ascii", 0, Math.min(6, buf.length));
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** true, если провайдер/модель в текущих настройках умеют смотреть на картинки. Все актуальные
 *  модели Claude — мультимодальные по умолчанию; у Qwen vision есть только у qwen-vl-* моделей,
 *  обычный qwen-max/qwen-plus текстовый и вернёт ошибку на image-блок. */
export function supportsVision(settings) {
  if (settings.provider === "anthropic") return true;
  return /vl/i.test(settings.model || "");
}

/** Разбирает task_media задания на текстовые формулы (из MathML) и картинки для vision. */
export function buildTaskAttachments(mediaRows, allowVision) {
  const formulasText = [];
  const imageBlocks = [];
  for (const m of mediaRows ?? []) {
    const full = path.join(STORAGE_ROOT, "task-media", m.storage_path);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    const looksLikeSvg = m.storage_path.toLowerCase().endsWith(".svg") || buf.slice(0, 200).toString("utf8").trimStart().toLowerCase().startsWith("<svg");
    if (looksLikeSvg) {
      const mathml = buf.toString("utf8").match(/<!--\s*MathML:\s*([\s\S]*?)\s*-->/i);
      if (mathml) formulasText.push(decodeEntities(mathml[1].trim()));
      // SVG без MathML-комментария — редкий случай, растеризации SVG у нас нет, пропускаем
      continue;
    }
    if (!allowVision || imageBlocks.length >= 4) continue; // не раздуваем промпт без нужды
    const mime = sniffMime(buf) ?? (/\.jpe?g$/i.test(m.storage_path) ? "image/jpeg" : /\.png$/i.test(m.storage_path) ? "image/png" : null);
    if (!mime) continue;
    imageBlocks.push({ mime, base64: buf.toString("base64") });
  }
  return { formulasText, imageBlocks };
}

/** Собирает content сообщения пользователя в формате конкретного провайдера. Возвращает обычную
 *  строку, если вложений нет (не меняем форму запроса там, где и раньше был просто текст). */
export function buildUserContent(provider, messageText, attachments) {
  const hasAttachments = attachments.formulasText.length > 0 || attachments.imageBlocks.length > 0;
  if (!hasAttachments) return messageText;

  const notes = [];
  if (attachments.formulasText.length) notes.push(`Формулы на иллюстрациях к заданию: ${attachments.formulasText.join("; ")}.`);
  if (attachments.imageBlocks.length) notes.push("К заданию приложено изображение (график/схема/рисунок) — посмотри на него и опирайся на него в объяснении.");
  const prefixedText = notes.join(" ") + "\n\n" + messageText;

  if (!attachments.imageBlocks.length) return prefixedText;

  if (provider === "anthropic") {
    const blocks = attachments.imageBlocks.map((img, i) => ({
      type: "image",
      source: { type: "base64", media_type: img.mime, data: img.base64 },
      // кэшируем последнюю картинку — при 2-3 подсказках подряд по одному заданию (частый
      // сценарий) повторная отправка тех же байт станет вчетверо дешевле, а не по полной цене
      ...(i === attachments.imageBlocks.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
    }));
    blocks.push({ type: "text", text: prefixedText });
    return blocks;
  }

  // Qwen / OpenAI-совместимый формат
  const blocks = attachments.imageBlocks.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}` } }));
  blocks.push({ type: "text", text: prefixedText });
  return blocks;
}
