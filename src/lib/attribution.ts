// Откуда пришёл человек: метки рекламы (utm_*, yclid, gclid), внешний реферер и страница входа. Собираются при ПЕРВОМ
// же заходе (до регистрации, которая случается позже и на другой странице) и хранятся в браузере; при регистрации
// уходят на сервер (POST /auth/signup → docker/api/attribution.js) и попадают в отчёт /admin → Источники.
// first — самый первый заход; last — последний заход с метками (иначе совпадает с first). Всё в try/catch: без
// localStorage (приватный режим) регистрация работает как раньше, просто без меток.
export interface Touch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  yclid?: string;
  gclid?: string;
  /** хост внешнего сайта, с которого пришли (без пути) */
  referrer?: string;
  /** страница входа (путь без параметров) */
  landing?: string;
  at?: string;
}

export interface Attribution {
  first: Touch;
  last: Touch;
}

const KEY = "ege-pro.attribution.v1";
const MAX = 120;
const MARK_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "yclid", "gclid"] as const;

const clean = (v: string | null | undefined): string | undefined => {
  // eslint-disable-next-line no-control-regex
  const s = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX);
  return s || undefined;
};

/** Касание по адресу страницы и реферреру. Чистая функция — вся логика здесь, проверяется тестами. */
export function touchFromLocation(search: string, referrer: string, pathname: string, ownHost: string, now = new Date()): Touch {
  const q = new URLSearchParams(search);
  const t: Touch = {};
  for (const k of MARK_KEYS) {
    const v = clean(q.get(k));
    if (v) t[k] = v;
  }
  try {
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
    if (host && host !== ownHost.replace(/^www\./, "")) t.referrer = host.slice(0, MAX);
  } catch {
    /* битый referrer — пропускаем */
  }
  t.landing = clean(pathname) ?? "/";
  t.at = now.toISOString();
  return t;
}

/** Есть ли в касании то, что делает заход «размеченным» (реклама / внешний сайт). */
export const isMarked = (t: Touch): boolean => MARK_KEYS.some((k) => !!t[k]) || !!t.referrer;

/** Обновляет сохранённые first/last новым заходом: first пишется один раз, last — только по размеченному заходу. */
export function mergeAttribution(prev: Attribution | null, touch: Touch): Attribution {
  if (!prev) return { first: touch, last: touch };
  return { first: prev.first, last: isMarked(touch) ? touch : prev.last };
}

export function readAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Attribution;
    return a?.first && a?.last ? a : null;
  } catch {
    return null;
  }
}

/** Вызывается один раз при старте приложения (src/main.tsx), ДО того, как роутер поправит адрес и сотрёт параметры. */
export function captureAttribution(): void {
  try {
    const touch = touchFromLocation(window.location.search, document.referrer, window.location.pathname, window.location.hostname);
    localStorage.setItem(KEY, JSON.stringify(mergeAttribution(readAttribution(), touch)));
  } catch {
    /* хранилище недоступно — работаем без меток */
  }
}

/** То, что отправляется при регистрации (или null, если ничего не накопилось). */
export function getAttributionForSignup(): Attribution | null {
  return readAttribution();
}
