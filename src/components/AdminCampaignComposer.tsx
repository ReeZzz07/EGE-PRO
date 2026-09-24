// Окно «Написать по фильтру»: кому (фильтр таблицы + точное число получателей), что отправляем (заготовка
// или своё письмо с предпросмотром и тестовой отправкой себе), отправка с подтверждением и ход рассылки.
// Логика защит — на сервере (docker/api/campaigns.js): здесь только показываем и просим подтвердить.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import type { AdminUserFilters } from "../lib/adminUsers";
import {
  cancelCampaign,
  CAMPAIGN_PRESETS,
  createCampaign,
  CTA_OPTIONS,
  loadCampaign,
  previewCampaign,
  renderCampaign,
  sendCampaignTest,
  type CampaignContent,
  type CampaignDetail,
  type CampaignPreview,
  type CampaignPreset,
} from "../lib/campaigns";
import { describeFilters } from "./AdminUserFilterPanel";
import { Icon, useToast } from "./ui";

const RECENT_DAYS = 7;

function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 font-display text-[15px] font-bold">
      <span className="flex h-6 w-6 items-center justify-center border-2 border-ink bg-hl text-[12px] font-black">{n}</span>
      {children}
    </h3>
  );
}

export function CampaignProgress({ detail, onCancel, cancelling }: { detail: CampaignDetail; onCancel?: () => void; cancelling?: boolean }) {
  const done = detail.sent + detail.failed + detail.skipped;
  const pct = detail.total > 0 ? Math.round((done / detail.total) * 100) : 100;
  const label = detail.status === "sending" ? "Отправляется…" : detail.status === "done" ? "Рассылка завершена" : "Рассылка отменена";
  return (
    <div className="border-2 border-ink/20 bg-sheet p-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-[15px] font-bold">{label}</p>
        {detail.status === "sending" && onCancel && (
          <button onClick={onCancel} disabled={cancelling} className="btn btn-red px-3.5 py-1.5 text-[12.5px]">
            {cancelling ? "Отменяем…" : "Отменить"}
          </button>
        )}
      </div>
      <div className="mt-3 h-3 overflow-hidden border-2 border-ink bg-paper" aria-hidden>
        <div className={`h-full transition-all ${detail.status === "cancelled" ? "bg-amber" : "bg-teal"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 font-mono text-[12px] text-ink2">
        Обработано {done} из {detail.total} · <span className="text-teal">отправлено {detail.sent}</span>
        {detail.failed > 0 && <span className="text-red"> · ошибок {detail.failed}</span>}
        {detail.skipped > 0 && <span> · пропущено {detail.skipped}</span>}
      </p>
      {detail.problems.length > 0 && (
        <ul className="mt-3 space-y-1 border-t-2 border-dashed border-ink/20 pt-3 text-[12px]">
          {detail.problems.map((p, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-mono">{p.email}</span>
              <span className={p.status === "failed" ? "text-red" : "text-ink2"}>{p.status === "failed" ? "ошибка" : "пропущен"}: {p.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  filters: AdminUserFilters;
  onApplyFilters: (f: AdminUserFilters) => void;
  onClose: () => void;
  onCreated?: () => void;
}

export default function AdminCampaignComposer({ filters, onApplyFilters, onClose, onCreated }: Props) {
  const { profile } = useAuth();
  const { push } = useToast();
  // заготовку подбираем по фильтру таблицы: не подтвердил почту → ссылка, не прошёл онбординг → анкета,
  // не проходил диагностику → диагностика; иначе пустое «своё письмо» (случайно не отправить чужой текст)
  const [presetId, setPresetId] = useState<CampaignPreset["id"]>(() =>
    filters.funnel.confirmed === "no" ? "verify" : filters.funnel.onboarded === "no" ? "onboarding" : filters.funnel.diagnostic === "no" ? "diagnostic" : "custom"
  );
  const [drafts, setDrafts] = useState<Record<string, CampaignContent>>(() => Object.fromEntries(CAMPAIGN_PRESETS.map((p) => [p.id, { ...p.content }])));
  const [excludeRecent, setExcludeRecent] = useState(true);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlSubject, setHtmlSubject] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const reqRef = useRef(0);

  const preset = CAMPAIGN_PRESETS.find((p) => p.id === presetId)!;
  const kind = preset.kind;
  const content = drafts[presetId];
  const setContent = (patch: Partial<CampaignContent>) => {
    setDrafts((d) => ({ ...d, [presetId]: { ...d[presetId], ...patch } }));
    setAck(false); // текст изменился — подтверждение «я проверил» нужно дать заново
  };
  const contentOk = kind === "verify_link" || (content.subject.trim() !== "" && content.bodyText.trim() !== "");

  // получатели — при смене вида, фильтра или опции «исключить недавних»
  useEffect(() => {
    const req = ++reqRef.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      previewCampaign(kind, filters, excludeRecent).then((res) => {
        if (req !== reqRef.current) return;
        setPreviewing(false);
        setPreview(res.preview ?? null);
        setPreviewError(res.error ?? null);
        setAck(false);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [kind, filters, excludeRecent]);

  // предпросмотр письма — при смене текста (только для своего письма)
  useEffect(() => {
    if (kind !== "custom" || !contentOk) {
      setHtml(null);
      setRenderError(null);
      return;
    }
    const t = setTimeout(() => {
      renderCampaign(content).then((res) => {
        if (res.error) return setRenderError(res.error);
        setRenderError(null);
        setHtml(res.html ?? null);
        setHtmlSubject(res.subject ?? "");
      });
    }, 500);
    return () => clearTimeout(t);
  }, [kind, contentOk, content]);

  // ход рассылки
  const campaignId = campaign?.id;
  const campaignStatus = campaign?.status;
  useEffect(() => {
    if (!campaignId || campaignStatus !== "sending") return;
    const timer = setInterval(() => {
      loadCampaign(campaignId).then((c) => c && setCampaign(c));
    }, 1500);
    return () => clearInterval(timer);
  }, [campaignId, campaignStatus]);

  const chips = describeFilters(filters);
  if (filters.q.trim()) chips.unshift({ id: "q", text: `Поиск: «${filters.q.trim()}»`, clear: (f) => f });

  const canSend = !!preview && preview.count > 0 && !preview.overLimit && contentOk && ack && !submitting && !previewing;

  const send = async () => {
    if (!preview) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await createCampaign({ kind, content, filters, excludeRecent, confirmCount: preview.count });
    setSubmitting(false);
    if (res.error || !res.id) {
      setSubmitError(res.error ?? "Не удалось создать рассылку");
      setAck(false);
      if (res.code === "COUNT_MISMATCH" && typeof res.count === "number") setPreview((p) => (p ? { ...p, count: res.count! } : p));
      return;
    }
    push(`Рассылка запущена: ${res.total} получателей`, "ok");
    onCreated?.();
    const detail = await loadCampaign(res.id);
    if (detail) setCampaign(detail);
  };

  const cancel = async () => {
    if (!campaign) return;
    setCancelling(true);
    const res = await cancelCampaign(campaign.id);
    setCancelling(false);
    if (res.error) push(res.error, "err");
    const detail = await loadCampaign(campaign.id);
    if (detail) setCampaign(detail);
  };

  const test = async () => {
    setTesting(true);
    const res = await sendCampaignTest(content);
    setTesting(false);
    if (res.error) push(res.error, "err");
    else push(`Тестовое письмо ушло на ${profile?.email}`, "ok");
  };

  const applySuggested = useCallback(() => {
    if (!preset.suggested) return;
    onApplyFilters({ ...filters, funnel: { ...filters.funnel, ...preset.suggested.funnel } });
  }, [preset, filters, onApplyFilters]);

  return (
    <div className="bg-white p-5 sm:p-6">
      <div className="pr-10">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-blue">рассылка по фильтру</p>
        <h2 className="font-display mt-1 text-xl font-black">Написать пользователям</h2>
      </div>

      {campaign ? (
        <div className="mt-5 space-y-4">
          <CampaignProgress detail={campaign} onCancel={cancel} cancelling={cancelling} />
          <p className="text-[12.5px] leading-relaxed text-ink2">
            Письма уходят по одному с паузой, чтобы не перегружать почтовый сервер. Окно можно закрыть — рассылка продолжится в фоне; ход и итоги — во вкладке «Рассылки».
          </p>
          <button onClick={onClose} className="btn btn-ink px-5 py-2.5 text-[13px]">
            Закрыть
          </button>
        </div>
      ) : (
        <>
          {/* 1. кому */}
          <section className="mt-5 space-y-3">
            <StepTitle n={1}>Кому</StepTitle>
            {chips.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Условия отбора">
                {chips.map((c) => (
                  <li key={c.id} className="rounded-sm border-2 border-ink/25 bg-paper px-2 py-1 text-[12px] font-semibold">
                    {c.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-l-4 border-amber bg-amber/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">
                <strong className="text-ink">Фильтр не задан</strong> — получателями будут все подходящие пользователи. Закрой окно и задай условия в таблице или нажми «Применить фильтр» ниже.
              </p>
            )}

            <div className="flex flex-wrap items-stretch gap-3">
              <div className="min-w-[180px] border-2 border-ink bg-hl px-4 py-3">
                <p className="font-display text-3xl font-black tabular-nums leading-none" data-testid="recipients-count">
                  {previewing && !preview ? "…" : (preview?.count ?? "—")}
                </p>
                <p className="mt-1 text-[12px] font-bold">получателей</p>
              </div>
              <div className="min-w-[220px] flex-1 space-y-2 text-[12.5px] text-ink2">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={excludeRecent} onChange={(e) => setExcludeRecent(e.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>
                    Не писать тем, кому рассылка уже уходила за последние {RECENT_DAYS} дней
                    {preview && excludeRecent && preview.excludedRecent > 0 ? <strong className="text-ink"> (исключено: {preview.excludedRecent})</strong> : null}
                  </span>
                </label>
                <p>Админы, анонимизированные и служебные адреса не получают рассылки никогда.{kind === "verify_link" && " Ссылку получат только те, кто почту не подтвердил."}</p>
              </div>
            </div>

            {previewError && <p role="alert" className="text-[13px] font-bold text-red">{previewError}</p>}
            {preview?.overLimit && (
              <p role="alert" className="border-l-4 border-red bg-red/8 px-3.5 py-2.5 text-[12.5px] font-bold text-red">
                Получателей {preview.count} — больше лимита {preview.maxRecipients} на одну рассылку. Уточни фильтр.
              </p>
            )}
            {preview && preview.count === 0 && !previewing && <p className="text-[13px] font-bold text-ink2">По этим условиям получателей нет.</p>}
            {preview && preview.sample.length > 0 && (
              <div>
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Например</p>
                <ul className="mt-1.5 divide-y divide-ink/10 border-2 border-ink/15 text-[12.5px]">
                  {preview.sample.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                      <span className="font-bold">{s.full_name || "Без имени"}</span>
                      <span className="font-mono text-[11.5px] text-ink2">{s.email}</span>
                    </li>
                  ))}
                  {preview.count > preview.sample.length && <li className="px-3 py-1.5 font-mono text-[11.5px] text-ink2">…и ещё {preview.count - preview.sample.length}</li>}
                </ul>
              </div>
            )}
          </section>

          {/* 2. что отправляем */}
          <section className="mt-7 space-y-3">
            <StepTitle n={2}>Что отправляем</StepTitle>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Заготовка письма">
              {CAMPAIGN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={p.id === presetId}
                  onClick={() => {
                    setPresetId(p.id);
                    setAck(false);
                  }}
                  className={`border-2 px-3 py-1.5 text-[12.5px] font-bold transition ${p.id === presetId ? "border-ink bg-ink text-paper" : "border-ink/20 bg-paper hover:border-ink/50"}`}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink2">{preset.hint}</p>
            {preset.suggested && (
              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink2">
                <span>
                  Обычно для этого нужен фильтр: <strong className="text-ink">{preset.suggested.label}</strong>
                </span>
                <button onClick={applySuggested} className="btn btn-ghost px-2.5 py-1 text-[12px]">
                  Применить фильтр
                </button>
              </p>
            )}

            {kind === "verify_link" ? (
              <p className="border-l-4 border-blue bg-blue/8 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink2">
                Каждому получателю уйдёт стандартное письмо «Подтверди почту» со <strong className="text-ink">свежей ссылкой</strong> (действует сутки). Ранее отправленные ссылки этим людям перестанут
                работать — работает последняя. Текст этого письма не редактируется.
              </p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <label className="block">
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Тема письма</span>
                    <input value={content.subject} onChange={(e) => setContent({ subject: e.target.value })} maxLength={200} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Метка над приветствием</span>
                    <input value={content.eyebrow} onChange={(e) => setContent({ eyebrow: e.target.value })} maxLength={60} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2 text-[13px]" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
                      Текст <span className="font-normal normal-case">(пустая строка — новый абзац; {"{имя}"} подставит имя ученика)</span>
                    </span>
                    <textarea
                      value={content.bodyText}
                      onChange={(e) => setContent({ bodyText: e.target.value })}
                      rows={9}
                      maxLength={5000}
                      className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Текст кнопки</span>
                      <input value={content.ctaLabel} onChange={(e) => setContent({ ctaLabel: e.target.value })} maxLength={60} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]" />
                    </label>
                    <label className="block">
                      <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Куда ведёт кнопка</span>
                      <select value={content.ctaPath} onChange={(e) => setContent({ ctaPath: e.target.value as CampaignContent["ctaPath"] })} className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]">
                        {CTA_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
                      Подвал <span className="font-normal normal-case">(пометка внизу письма; можно оставить пустым)</span>
                    </span>
                    <textarea value={content.footer} onChange={(e) => setContent({ footer: e.target.value })} rows={2} maxLength={400} className="input-blank mt-1.5 w-full resize-y rounded-sm px-3.5 py-2 text-[13px]" />
                  </label>
                  <button onClick={test} disabled={testing || !contentOk} className="btn btn-ghost px-4 py-2 text-[12.5px]">
                    <Icon name="send" size={13} /> {testing ? "Отправляем…" : `Тестовое на ${profile?.email ?? "мою почту"}`}
                  </button>
                </div>

                <div>
                  <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Как выглядит письмо (имя — образец)</span>
                  {htmlSubject && (
                    <p className="mt-1.5 text-[12.5px] text-ink2">
                      Тема: <strong className="text-ink">{htmlSubject}</strong>
                    </p>
                  )}
                  {renderError && <p className="mt-1 text-[12.5px] font-bold text-red">{renderError}</p>}
                  <div className="mt-1.5 overflow-hidden border-2 border-ink/20 bg-white">
                    {html ? <iframe title="Предпросмотр письма" srcDoc={html} sandbox="" className="h-[560px] w-full border-0" /> : <p className="p-6 text-center text-[13px] text-ink2">Заполни тему и текст — здесь появится письмо</p>}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3. отправка */}
          <section className="mt-7 space-y-3">
            <StepTitle n={3}>Отправка</StepTitle>
            <label className="flex items-start gap-2.5 border-2 border-ink/20 bg-sheet p-3.5">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={!preview || preview.count === 0 || preview.overLimit} className="mt-0.5 h-4 w-4" />
              <span className="text-[13px] leading-relaxed">
                Я проверил(а) получателей и текст: письмо получат ровно <strong>{preview?.count ?? 0}</strong> человек, отозвать отправленное будет нельзя.
              </span>
            </label>
            {submitError && (
              <p role="alert" className="text-[13px] font-bold text-red">
                {submitError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={send} disabled={!canSend} className="btn btn-blue px-6 py-3 text-sm disabled:opacity-40">
                <Icon name="send" size={15} /> {submitting ? "Запускаем…" : `Отправить ${preview?.count ?? 0} письмам`}
              </button>
              <button onClick={onClose} className="btn btn-ghost px-4 py-3 text-[13px]">
                Отмена
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
