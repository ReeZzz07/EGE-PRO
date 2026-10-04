// Страница «Контакты» (/contacts, публичная): почта и мессенджеры поддержки, реквизиты ИП и форма обратной
// связи. Обращение сервер сначала записывает в БД и только потом шлёт письма (docker/api/feedback.js), поэтому
// после отправки показываем его номер. Вошедшему пользователю почта подставляется из аккаунта, ниже — список его
// прошлых обращений со статусами и ответами. Каналы связи (WhatsApp/Telegram/VK) включаются в админке ссылкой.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { isValidEmail } from "../lib/validation";
import { DEFAULT_LEGAL_ENTITY, loadLegalEntityInfo, type LegalEntityInfo } from "../lib/legalEntity";
import { useDocumentHead } from "../lib/useDocumentHead";
import {
  FEEDBACK_TOPICS, MAX_MESSAGE, MIN_MESSAGE, STATUS_LABEL, TOPIC_LABEL,
  loadMyFeedback, sendFeedback, useContactInfo,
  type FeedbackTopic, type MyFeedback,
} from "../lib/feedback";
import { Icon } from "./ui";
import type { View } from "./Header";

const ID = "contacts-field";
const dateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function MyRequests({ items }: { items: MyFeedback[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="my-requests">
      <h2 id="my-requests" className="font-display text-lg font-black">
        Мои обращения
      </h2>
      <ul className="mt-3 space-y-3">
        {items.map((r) => (
          <li key={r.id} className="sheet p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13.5px] font-bold">
                №{r.id} · {TOPIC_LABEL[r.topic] ?? r.topic}
              </p>
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-blue">{STATUS_LABEL[r.status]}</span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-ink2">{dateTime(r.createdAt)}</p>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-ink2">{r.message}</p>
            {r.replies.map((rep, i) => (
              <p key={i} className="mt-2 border-l-4 border-blue bg-blue/5 px-3 py-2 text-[13px] leading-relaxed">
                <strong>Ответ команды{rep.at ? ` · ${dateTime(rep.at)}` : ""}:</strong> {rep.text}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ContactsView({ onNav, topic: initialTopic, taskId }: { onNav: (v: View) => void; topic?: FeedbackTopic; taskId?: string }) {
  const { profile, isGuestMode } = useAuth();
  const loggedIn = !!profile && !isGuestMode;
  const info = useContactInfo();
  const [legal, setLegal] = useState<LegalEntityInfo>(DEFAULT_LEGAL_ENTITY);
  const openedAt = useRef(Date.now());

  const [topic, setTopic] = useState<FeedbackTopic | "">(initialTopic ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<number | null | undefined>(undefined);
  const [mine, setMine] = useState<MyFeedback[]>([]);

  useDocumentHead({
    title: "Контакты — ЕГЭ·ПРО",
    description: "Связаться с командой ЕГЭ·ПРО: почта поддержки, мессенджеры и форма обратной связи. Отвечаем в течение одного дня.",
    path: "/contacts",
    ogImage: "",
  });

  useEffect(() => {
    loadLegalEntityInfo().then(setLegal);
  }, []);
  useEffect(() => {
    if (loggedIn) loadMyFeedback().then(setMine);
  }, [loggedIn]);
  // профиль подгружается асинхронно — подставляем имя и почту, как только они появились и поле ещё не тронуто
  useEffect(() => {
    if (profile?.name) setName((n) => n || profile.name);
    if (profile?.email) setEmail((e) => e || profile.email);
  }, [profile?.name, profile?.email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!topic) return setError("Выбери тему обращения.");
    if (!loggedIn && !isValidEmail(email)) return setError("Укажи корректную почту — на неё придёт ответ.");
    if (message.trim().length < MIN_MESSAGE) return setError(`Опиши вопрос подробнее — хотя бы ${MIN_MESSAGE} символов.`);
    if (!consent) return setError("Нужно согласие на обработку данных, чтобы мы могли ответить.");
    setBusy(true);
    const res = await sendFeedback({
      topic,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      consent,
      taskId,
      source: window.location.pathname === "/contacts" ? "/contacts" : window.location.pathname,
      website,
      elapsedMs: Date.now() - openedAt.current,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setSentId(res.id ?? null);
    setMessage("");
    if (loggedIn) loadMyFeedback().then(setMine);
  };

  const reply = info.replyWithinHours === 24 ? "в течение одного дня" : `в течение ${info.replyWithinHours} часов`;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="mt-8 sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">контакты</p>
        <h1 className="font-display mt-2 text-2xl font-black sm:text-3xl">Напиши нам</h1>
        <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink2">
          Вопрос по оплате, ошибка в задании, идея или предложение — всё читает команда, а не робот. Ответим {reply}.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* форма */}
        <div>
          {sentId !== undefined ? (
            <div className="sheet anim-rise p-5 sm:p-6" role="status">
              <p className="font-display text-lg font-black">{sentId ? `Обращение №${sentId} принято` : "Обращение принято"}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">
                Ответим {reply} на {loggedIn ? "почту аккаунта" : email.trim() || "указанную почту"}. Подтверждение придёт письмом
                {sentId ? ` с номером ${sentId}` : ""} — проверь и папку «Спам».
              </p>
              <button onClick={() => setSentId(undefined)} className="btn btn-ghost mt-4 px-4 py-2 text-[13px]">
                Написать ещё
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="sheet space-y-4 p-5 sm:p-6" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${ID}-topic`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
                    тема
                  </label>
                  <select id={`${ID}-topic`} value={topic} onChange={(e) => setTopic(e.target.value as FeedbackTopic)} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2.5 text-[14px]">
                    <option value="">Выбери тему…</option>
                    {FEEDBACK_TOPICS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${ID}-name`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
                    имя
                  </label>
                  <input id={`${ID}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[14px]" />
                </div>
              </div>

              <div>
                <label htmlFor={`${ID}-email`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
                  почта для ответа
                </label>
                <input
                  id={`${ID}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={loggedIn}
                  autoComplete="email"
                  placeholder="mail@example.com"
                  className={`input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-[14px] ${loggedIn ? "opacity-70" : ""}`}
                />
                {loggedIn && <p className="mt-1 text-[11.5px] text-ink2">Ответ придёт на почту твоего аккаунта.</p>}
              </div>

              <div>
                <label htmlFor={`${ID}-message`} className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
                  сообщение
                </label>
                <textarea
                  id={`${ID}-message`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={7}
                  maxLength={MAX_MESSAGE}
                  placeholder={taskId ? `Что не так в задании ${taskId}?` : "Опиши вопрос или проблему как можно подробнее: что делал(а), что ожидал(а), что получилось."}
                  className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-3 text-[14px] leading-relaxed"
                />
                <p className="mt-1 text-right font-mono text-[11px] text-ink2">
                  {message.trim().length} / {MAX_MESSAGE}
                </p>
              </div>

              {taskId && <p className="text-[12.5px] text-ink2">К обращению приложено задание: <strong className="font-mono text-ink">{taskId}</strong></p>}

              {/* ловушка для ботов: людям не видна и до неё не добраться табом */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor={`${ID}-website`}>Сайт</label>
                <input id={`${ID}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-ink2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-blue" />
                <span>
                  Согласен(на) на обработку введённых данных, чтобы получить ответ, в соответствии с{" "}
                  <button type="button" onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold text-ink">
                    политикой конфиденциальности
                  </button>
                  .
                </span>
              </label>

              {error && (
                <p role="alert" className="anim-rise flex items-start gap-2 text-[13px] font-bold text-red">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {error}
                </p>
              )}

              <button type="submit" disabled={busy} className="btn btn-ink px-5 py-2.5 text-[13px]">
                {busy ? "Отправляем…" : "Отправить"}
              </button>
            </form>
          )}
        </div>

        {/* контакты */}
        <aside className="space-y-4">
          <div className="sheet p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">почта поддержки</p>
            <a href={`mailto:${info.supportEmail}`} className="link-slide mt-1.5 block break-all font-display text-[17px] font-black text-blue">
              {info.supportEmail}
            </a>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">Отвечаем {reply}.</p>
            {info.channels.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {info.channels.map((c) => (
                  <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
                    {c.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="sheet p-5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">быстрые ответы</p>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              <li>
                <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold text-ink2 hover:text-ink">
                  Условия оплаты и возврата — в оферте
                </button>
              </li>
              <li>
                <button onClick={() => onNav(profile ? { name: "settings" } : { name: "auth", mode: "login" })} className="link-slide font-bold text-ink2 hover:text-ink">
                  Смена пароля и удаление аккаунта — в настройках
                </button>
              </li>
              <li>
                <button onClick={() => onNav({ name: "tariffs" })} className="link-slide font-bold text-ink2 hover:text-ink">
                  Что входит в тарифы
                </button>
              </li>
            </ul>
          </div>

          {(legal.inn || legal.ogrnip) && (
            <div className="sheet p-5">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">реквизиты</p>
              <p className="mt-2 font-mono text-[12.5px] leading-relaxed">
                {legal.inn && <>ИНН {legal.inn}</>}
                {legal.inn && legal.ogrnip && <br />}
                {legal.ogrnip && <>ОГРНИП {legal.ogrnip}</>}
              </p>
            </div>
          )}
        </aside>
      </div>

      {loggedIn && <MyRequests items={mine} />}
    </div>
  );
}
