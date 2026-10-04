// Фильтр текста в формах обращений и отзывов: запрещённые слова (с производными и обходами написания) и
// контакты (телефоны, почта, ссылки, @-ники и приглашения в мессенджеры). Правила хранятся в
// public.app_settings, ключ 'content_filter', и правятся в /admin → Обращения → Фильтр текста; пока админ
// ничего не сохранял, действуют стандартные (DEFAULT_*). Срабатывания пишутся в public.content_filter_log
// (миграция 0039), чтобы видеть реальные попытки и править ложные срабатывания.
//
// Как ищутся слова. Текст приводится к «каркасу»: нижний регистр, ё→е, без ъ/ь, без невидимых символов,
// подряд идущие одинаковые буквы схлопываются (хуууй → хуй), латинские буквы-двойники и цифры внутри русского
// слова заменяются (xуй, п0рно), буквы с разделителями склеиваются (х у й, х.у.й). Дальше слово проверяется
// по строкам списка:
//     слово     — основа: подходит само слово, любые окончания и до двух приставок (за-, по-, вы-, раз- …);
//     =слово    — только это слово целиком (для коротких слов, у которых основа дала бы ложные срабатывания);
//     ~фраза    — фраза целиком, по границам слов.
// «Исключения» (allow) — слова, которые никогда не считаются запрещёнными: «слово» — точно, «слово*» — с любым окончанием.
import { createHash } from "node:crypto";
import { pool } from "./db.js";

export const TARGETS = ["feedback", "reviews"];
export const TARGET_LABEL = { feedback: "Обращения", reviews: "Отзывы" };

export const DEFAULT_WORDS_TEXT = `# Одно слово в строке. «слово» — основа с производными (окончания и приставки), «=слово» — только это слово целиком,
# «~фраза» — фраза целиком. Строки, начинающиеся с #, — комментарии. Список можно менять как угодно.

# — мат и грубые оскорбления
хуй
хуе
хуя
=хули
пизд
спизд
ебат
ебан
ебал
ебаш
ебла
ебуч
ебну
ебош
ебак
ебач
ебис
ебут
ебет
ебыр
ебен
ебок
долбоеб
долбаеб
бляд
блят
блеат
=бля
сука
сукин
=сукой
сучар
мудак
мудач
мудил
мудозв
мудоз
пидор
пидар
пидр
=педик
=педики
=педика
=педиков
=педику
=педиком
=педике
педераст
педрил
гандон
гондон
залуп
шлюх
шалав
мраз
говн
дермов
дермищ
=дермо
срат
срал
срак
жоп
дроч
ублюд
=хер
=хера
херн
=чмо
=падла
=залупа

# — латиницей и транслитом
huy
pizd
blyat
blyad
ebat
ebal
ebanut
pidor
pidar
mudak
gandon
zalup
fuck
=shit
=shitty
bitch
cunt
=dick
asshole
=nigger
=niggers
nigga
faggot

# — спам, реклама, запрещённая тематика
казино
букмекер
=порно
порнух
порнуш
порнограф
эскорт
виагр
накрутк
раскрутк
~заработок в интернете
~быстрые деньги
~пассивный доход
~ставки на спорт
`;

export const DEFAULT_ALLOW_TEXT = `# Слова-исключения: никогда не считаются запрещёнными. «слово» — точно, «слово*» — с любым окончанием.
ебионит*
себастьян*
`;

export const DEFAULT_TARGET_RULES = { words: true, phones: true, emails: true, links: true, handles: true };

export const DEFAULT_CONFIG = {
  enabled: true,
  words: DEFAULT_WORDS_TEXT,
  allow: DEFAULT_ALLOW_TEXT,
  allowedDomains: "ege-tutor.ru",
  targets: { feedback: { ...DEFAULT_TARGET_RULES }, reviews: { ...DEFAULT_TARGET_RULES } },
};

export class ContentFilterError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.status = 422;
    this.violations = violations;
  }
}

// ─────────────────────── нормализация ───────────────────────

// диапазоны кодовых точек собираем из чисел: прямые юникод-escape в литерале здесь не нужны
const charClass = (ranges) => ranges.map(([a, b]) => String.fromCharCode(a) + (b ? "-" + String.fromCharCode(b) : "")).join("");
const INVISIBLE_CODES = [[0x200b, 0x200f], [0x2028, 0x202f], [0x2060, 0x2064], [0xfeff], [0x00ad], [0x034f], [0x180e]];
const ZERO_WIDTH = new RegExp(`[${charClass(INVISIBLE_CODES)}]|[${charClass([[0x0300, 0x036f]])}]`, "g");
const SPACE_LIKE = new RegExp(`[${charClass([[0x00a0], [0x2000, 0x200a]])}]`, "g");
const LATIN_LOOKALIKE = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", h: "н", t: "т", b: "в" };
const DIGIT_LOOKALIKE = { 0: "о", 3: "з", 6: "б" };
const HAS_CYR = /[а-я]/;
const HAS_LAT = /[a-z]/;

/** Приставки, которые могут стоять перед основой (до двух подряд). Одиночные «с», «о», «в», «у» допустимы, потому что
 *  в стандартном списке нет коротких основ вроде «еб-»/«ебе»: «себе», «себастьян», «обед», «вебер» не срабатывают. */
const PREFIXES = ["по", "на", "за", "вы", "до", "от", "об", "при", "про", "раз", "рас", "под", "пере", "пре", "над", "из", "ис", "вз", "вс", "воз", "вос", "со", "не", "ни", "недо", "пред", "меж", "ото", "подо", "обез", "без", "бес", "у", "в", "о", "с"];

const collapse = (s) => s.replace(/(.)\1+/gu, "$1");

/** Базовая чистка: NFKC, нижний регистр, ё→е, без невидимых символов. */
function baseClean(text) {
  return String(text ?? "").normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase().replace(/ё/g, "е");
}

/** Слово в «каркас»: смешанное по алфавитам слово приводится к кириллице (латинские двойники, цифры), убираются ъ/ь,
 *  схлопываются повторы. Чисто латинское слово остаётся латинским. */
function normalizeToken(token) {
  let t = token.replace(/[ъь]/g, "");
  if (HAS_CYR.test(t)) {
    t = [...t].map((ch) => LATIN_LOOKALIKE[ch] ?? DIGIT_LOOKALIKE[ch] ?? ch).join("");
  }
  return collapse(t);
}

/** Склеивает буквы, разнесённые разделителями: «х у й», «х.у.й», «п-и-з-д» (не меньше трёх одиночных букв подряд). */
function joinSpaced(text) {
  return text.replace(/(?<![\p{L}\p{N}])(?:\p{L}[\s.\-_*,'"`~|/\\]+){2,}\p{L}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[\s.\-_*,'"`~|/\\]+/g, ""));
}

/** Список слов текста в каркасе + склеенный текст для фраз. */
export function tokenize(text) {
  const cleaned = joinSpaced(baseClean(text));
  const tokens = (cleaned.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeToken).filter(Boolean);
  return tokens;
}

// ─────────────────────── правила слов ───────────────────────

/** Разбор текстовых списков в структуры (комментарии и пустые строки пропускаются, дубликаты убираются). */
export function parseWordRules(text) {
  const rules = [];
  const seen = new Set();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let mode = "stem";
    let body = line;
    if (line.startsWith("=")) {
      mode = "exact";
      body = line.slice(1);
    } else if (line.startsWith("~")) {
      mode = "phrase";
      body = line.slice(1);
    }
    body = body.trim();
    if (!body) continue;
    const value = mode === "phrase" ? tokenize(body).join(" ") : normalizeToken(baseClean(body).replace(/[^\p{L}\p{N}]/gu, ""));
    if (!value) continue;
    const key = `${mode}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ mode, value, source: line });
  }
  return rules;
}

export function parseAllowRules(text) {
  const exact = new Set();
  const prefix = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const star = line.endsWith("*");
    const value = normalizeToken(baseClean(star ? line.slice(0, -1) : line).replace(/[^\p{L}\p{N}]/gu, ""));
    if (!value) continue;
    (star ? prefix : []).push(value);
    if (!star) exact.add(value);
  }
  return { exact, prefix };
}

/** Короткие основы (до 4 букв) допускают только одну приставку: иначе «у-подо-блят(ься)» давало бы «блят». */
function stemMatches(token, stem, depth = 0, maxDepth = stem.length >= 5 ? 2 : 1) {
  if (token.startsWith(stem)) return true;
  if (depth >= maxDepth) return false;
  for (const p of PREFIXES) {
    if (token.length > p.length && token.startsWith(p) && stemMatches(token.slice(p.length), stem, depth + 1, maxDepth)) return true;
  }
  return false;
}

function isAllowed(token, allow) {
  if (allow.exact.has(token)) return true;
  return allow.prefix.some((p) => token.startsWith(p));
}

/** Запрещённые слова в тексте: [{ kind: "word", match, rule }]. */
export function findForbiddenWords(text, rules, allow) {
  if (!rules.length) return [];
  const tokens = tokenize(text);
  const out = [];
  const seen = new Set();
  const add = (match, rule) => {
    if (!seen.has(match + rule)) {
      seen.add(match + rule);
      out.push({ kind: "word", match, rule });
    }
  };
  for (const token of tokens) {
    if (isAllowed(token, allow)) continue;
    const latin = HAS_LAT.test(token) && !HAS_CYR.test(token);
    for (const r of rules) {
      if (r.mode === "phrase") continue;
      const ruleLatin = HAS_LAT.test(r.value) && !HAS_CYR.test(r.value);
      if (ruleLatin !== latin) continue;
      if (r.mode === "exact" ? token === r.value : stemMatches(token, r.value)) {
        add(token, r.source);
        break;
      }
    }
  }
  const joined = ` ${tokens.join(" ")} `;
  for (const r of rules) {
    if (r.mode === "phrase" && joined.includes(` ${r.value} `)) add(r.value, r.source);
  }
  return out;
}

// ─────────────────────── контакты ───────────────────────

const TLDS = "ru|рф|su|com|net|org|info|biz|io|me|ly|co|tv|cc|xyz|top|site|online|shop|store|club|pro|app|dev|ai|by|kz|ua|uz|de|fr|uk|us|cn|tk|ml|ga|gq|cf|link|click|live|life|world|today|fun|space|website|tech|cloud|agency";
const DIGIT_WORDS = "ноль|нуль|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять";
const MESSENGERS = "телеграм\\p{L}*|телега|телеграмм\\p{L}*|тг|telegram|whatsapp|whats\\s?app|ватсап\\p{L}*|вотсап\\p{L}*|вацап\\p{L}*|вайбер\\p{L}*|viber|инстаграм\\p{L}*|инста|instagram|вконтакте|скайп\\p{L}*|skype|дискорд\\p{L}*|discord|snapchat|signal|сигнал";
const SOLICIT = "пиши|пишите|напиши|напишите|добавляй|добавляйся|добавляйтесь|звони|звоните|позвони|позвоните|свяжись|свяжитесь|мой ник|мой номер|мой аккаунт|мой id|в лс|в личку|в личные";

function hostAllowed(host, allowedDomains) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowedDomains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Контакты в тексте. kinds: ["phones","emails","links","handles"] — какие искать. Возвращает [{ kind, match }]. */
export function findContacts(text, { kinds, allowedDomains = [] }) {
  const out = [];
  const raw = baseClean(text);
  const t = raw.replace(SPACE_LIKE, " ");
  const want = new Set(kinds);

  if (want.has("emails")) {
    const std = t.match(/[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[a-zа-я]{2,}/giu) ?? [];
    for (const m of std) out.push({ kind: "emails", match: m });
    // «\b» в JS не знает кириллицу, поэтому границы слов — через lookaround
    const obf = t.match(/[a-z0-9._%+-]{2,}\s*(?:\(at\)|\[at\]|\(собака\)|(?<![\p{L}])(?:at|собака)(?![\p{L}]))\s*[a-z0-9-]{2,}\s*(?:\(dot\)|\[dot\]|\.|(?<![\p{L}])(?:dot|точка)(?![\p{L}]))\s*[a-z]{2,}/giu) ?? [];
    for (const m of obf) out.push({ kind: "emails", match: m });
  }

  if (want.has("links")) {
    const urls = t.match(/(?:https?:\/\/|hxxps?:\/\/|www\.|ftp:\/\/)[^\s<>"']+/giu) ?? [];
    for (const u of urls) {
      const host = u.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").split(/[/?#:]/)[0];
      if (!hostAllowed(host, allowedDomains)) out.push({ kind: "links", match: u });
    }
    const bare = t.matchAll(new RegExp(`(?<![\\p{L}\\p{N}@._-])((?:[a-zа-я0-9][a-zа-я0-9-]*\\.)+(?:${TLDS}))(?![\\p{L}\\p{N}])(?:/[^\\s]*)?`, "giu"));
    for (const m of bare) {
      if (/^(?:https?:\/\/|www\.)/i.test(m[0])) continue;
      if (!hostAllowed(m[1], allowedDomains) && !out.some((o) => o.match.includes(m[1]))) out.push({ kind: "links", match: m[0] });
    }
  }

  if (want.has("phones")) {
    const digits = t.match(/(?<![\d])(?:\+?\d{1,3}[\s\-.(]*)?\(?\d{3}\)?[\s\-.]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}(?![\d])/gu) ?? [];
    for (const m of digits) if (m.replace(/\D/g, "").length >= 10) out.push({ kind: "phones", match: m.trim() });
    for (const m of t.matchAll(/(?<![\d])\+?\d{10,15}(?![\d])/gu)) out.push({ kind: "phones", match: m[0] });
    const spelled = t.match(new RegExp(`(?:(?<![\\p{L}])(?:${DIGIT_WORDS})(?![\\p{L}])[\\s,.\\-]*){7,}`, "giu")) ?? [];
    for (const m of spelled) out.push({ kind: "phones", match: m.trim() });
  }

  if (want.has("handles")) {
    for (const m of t.matchAll(/(?<![\p{L}\p{N}_.])@[a-z0-9_.]{3,}/giu)) out.push({ kind: "handles", match: m[0] });
    // мессенджер рядом с призывом написать, ником или цифрами: «пиши в телеграм», «вотсап 8…», «tg: ivan_99»
    const re = new RegExp(`(?<![\\p{L}])(?:${MESSENGERS})(?![\\p{L}])`, "giu");
    for (const m of t.matchAll(re)) {
      const from = Math.max(0, m.index - 40);
      const around = t.slice(from, m.index + m[0].length + 40);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40);
      const hasSolicit = new RegExp(`(?<![\\p{L}])(?:${SOLICIT})(?![\\p{L}])`, "iu").test(around);
      // сразу после названия: номер, ник с цифрой/подчёркиванием («ivan_99», «egor1999») или «: ник»
      const hasId = /^[\s:\-–—@=]{0,4}(?:(?:\d[\s\-]*){5,}|[a-z][a-z0-9_.]*[0-9_][a-z0-9_.]*|(?<=:\s{0,2})[a-z]{3,})/iu.test(after);
      if (hasSolicit || hasId) out.push({ kind: "handles", match: m[0] });
    }
  }
  // одно и то же найденное разными правилами показываем один раз
  const seen = new Set();
  return out.filter((v) => {
    const key = `${v.kind}|${v.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─────────────────────── проверка ───────────────────────

const RULE_KINDS = [["phones", "phones"], ["emails", "emails"], ["links", "links"], ["handles", "handles"]];

/** Список доменов из строки «a.ru, b.com». */
export function parseDomains(text) {
  return [...new Set(String(text ?? "").toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
}

/** Чистая проверка одного текста по готовой конфигурации. violations пуст — текст чистый. */
export function checkText(text, target, config) {
  if (!config.enabled) return [];
  const rules = config.targets?.[target] ?? DEFAULT_TARGET_RULES;
  const violations = [];
  if (rules.words) violations.push(...findForbiddenWords(text, parseWordRules(config.words), parseAllowRules(config.allow)));
  const kinds = RULE_KINDS.map(([k, flag]) => (rules[flag] ? k : null)).filter(Boolean);
  if (kinds.length) violations.push(...findContacts(text, { kinds, allowedDomains: parseDomains(config.allowedDomains) }));
  return violations;
}

const CONTACT_LABEL = { phones: "телефон", emails: "почту", links: "ссылку", handles: "ник или приглашение в мессенджер" };

/** Сообщение пользователю: что убрать — без цитирования запрещённых слов. */
export function userMessage(violations, target) {
  const parts = [];
  const contactKinds = [...new Set(violations.filter((v) => v.kind !== "word").map((v) => v.kind))];
  if (contactKinds.length) {
    const what = contactKinds.map((k) => CONTACT_LABEL[k]).join(", ");
    parts.push(
      target === "reviews"
        ? `В отзыве нельзя оставлять контакты и ссылки. Уберите: ${what}.`
        : `В сообщении нельзя оставлять контакты и ссылки — ответ придёт на почту из формы. Уберите: ${what}.`
    );
  }
  if (violations.some((v) => v.kind === "word")) {
    parts.push("В тексте есть недопустимые выражения. Перефразируйте, пожалуйста, и отправьте снова.");
  }
  return parts.join(" ");
}

// ─────────────────────── настройки и журнал ───────────────────────

const clampText = (v, max, fallback) => (typeof v === "string" ? v.slice(0, max) : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

/** Сохранённое + умолчания; мусор не ломает проверку. */
export function sanitizeConfig(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const targets = {};
  for (const t of TARGETS) {
    targets[t] = {};
    for (const k of Object.keys(DEFAULT_TARGET_RULES)) targets[t][k] = bool(s.targets?.[t]?.[k], DEFAULT_TARGET_RULES[k]);
  }
  return {
    enabled: bool(s.enabled, true),
    words: clampText(s.words, 40000, DEFAULT_CONFIG.words),
    allow: clampText(s.allow, 10000, DEFAULT_CONFIG.allow),
    allowedDomains: clampText(s.allowedDomains, 500, DEFAULT_CONFIG.allowedDomains),
    targets,
  };
}

export async function loadFilterConfig() {
  try {
    const { rows } = await pool.query("select value from public.app_settings where key = 'content_filter'");
    return sanitizeConfig(rows[0]?.value);
  } catch (e) {
    console.warn("не удалось прочитать content_filter из app_settings, использую стандартные правила:", e?.message ?? e);
    return sanitizeConfig(null);
  }
}

export async function saveFilterConfig(input, adminId) {
  if (typeof input?.words === "string" && input.words.length > 40000) throw new ContentFilterError("Список слов слишком длинный (больше 40 000 символов).");
  const cfg = sanitizeConfig(input);
  const lines = String(cfg.words).split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length > 3000) throw new ContentFilterError("В списке слов больше 3000 строк — сократите его.");
  if (lines.some((l) => l.length > 80)) throw new ContentFilterError("Строка списка длиннее 80 символов — слова и фразы должны быть короткими.");
  if (cfg.allowedDomains.trim() && parseDomains(cfg.allowedDomains).length === 0) throw new ContentFilterError("Разрешённые домены: укажите через запятую, например ege-tutor.ru.");
  await pool.query(
    `insert into public.app_settings (key, value, updated_by) values ('content_filter', $1, $2)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`,
    [JSON.stringify(cfg), adminId ?? null]
  );
  return cfg;
}

const hashIp = (ip) => (ip ? createHash("sha256").update(`filter|${ip}`).digest("hex").slice(0, 32) : null);

export async function logBlock({ target, field, violations, text, userId, ip }) {
  try {
    await pool.query(
      "insert into public.content_filter_log (target, field, reasons, snippet, user_id, ip_hash) values ($1,$2,$3,$4,$5,$6)",
      [target, field, [...new Set(violations.map((v) => v.kind))], String(text).slice(0, 300), userId ?? null, hashIp(ip)]
    );
    await pool.query("delete from public.content_filter_log where created_at < now() - interval '90 days'");
  } catch (e) {
    console.warn("[content-filter] не удалось записать в журнал:", e?.message ?? e);
  }
}

export async function listFilterLog(limit = 100) {
  const { rows } = await pool.query(
    "select id, created_at, target, field, reasons, snippet from public.content_filter_log order by id desc limit $1",
    [Math.max(1, Math.min(300, Number(limit) || 100))]
  );
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, target: r.target, field: r.field, reasons: r.reasons, snippet: r.snippet }));
}

/** Полная очистка журнала срабатываний (кнопка в админке). Возвращает, сколько записей удалено. */
export async function clearFilterLog() {
  const { rowCount } = await pool.query("delete from public.content_filter_log");
  return rowCount ?? 0;
}

/**
 * Проверяет поля формы и бросает ContentFilterError (422) с понятным сообщением, если что-то не так.
 * fields: { имя_поля: текст }; срабатывание пишется в журнал.
 */
export async function assertCleanText(fields, target, ctx = {}) {
  const config = await loadFilterConfig();
  if (!config.enabled) return;
  const all = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const v = checkText(value, target, config);
    if (v.length) {
      all.push(...v);
      await logBlock({ target, field, violations: v, text: value, userId: ctx.userId, ip: ctx.ip });
    }
  }
  if (all.length) throw new ContentFilterError(userMessage(all, target), all.map((v) => ({ kind: v.kind })));
}
