// Источники: по каналам и кампаниям — сколько зарегистрировалось, подтвердило почту, прошло онбординг и диагностику, оплатило
// (docker/api/attribution.js). Показывает, откуда приходят люди, которые доходят до результата, а не только до регистрации.
// Блок про почтовые домены — доля подтверждений по сервисам: так видно проблемы доставки писем (например, Gmail).
import { useEffect, useState } from "react";
import { DIRECT_UTM_TEMPLATE, loadAttributionReport, type AttributionReport } from "../lib/adminAttribution";
import { useToast } from "./ui";

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));
const SPEND_KEY = "ege-pro.attribution-spend";

export default function AdminAttribution() {
  const { push } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [spend, setSpend] = useState(() => {
    try {
      return localStorage.getItem(SPEND_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    setLoading(true);
    loadAttributionReport(from || undefined, to || undefined).then((r) => {
      setReport(r);
      setLoading(false);
    });
  }, [from, to]);

  const setSpendSaved = (v: string) => {
    setSpend(v);
    try {
      localStorage.setItem(SPEND_KEY, v);
    } catch {
      /* без хранилища просто не запоминаем */
    }
  };
  const spendNum = Number(spend.replace(/\s/g, "").replace(",", "."));
  const t = report?.total;

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(DIRECT_UTM_TEMPLATE);
      push("Шаблон скопирован", "ok");
    } catch {
      push("Не удалось скопировать — выделите текст вручную", "err");
    }
  };

  const th = "px-2.5 py-2 text-right font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink2";
  const td = "px-2.5 py-2 text-right tabular-nums";
  const lbl = "font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2";

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[13px] leading-relaxed text-ink2">
        Канал и кампания берутся из меток в ссылке, по которой человек пришёл (utm_source, utm_campaign, yclid), или из сайта-источника. Считается последний
        размеченный заход, а если меток не было — первый. Регистрации, сделанные до внедрения (до <b>05.10.2026</b>), попадают в строку «нет данных»: метки у них не собирались.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={lbl}>С даты</span>
          <input id="at-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-blank mt-1.5 block rounded-sm px-2.5 py-2 text-[13px]" />
        </label>
        <label className="block">
          <span className={lbl}>По дату</span>
          <input id="at-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-blank mt-1.5 block rounded-sm px-2.5 py-2 text-[13px]" />
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setFrom(daysAgo(7));
              setTo("");
            }}
            className="btn btn-ghost px-3 py-2 text-[12.5px]"
          >
            7 дней
          </button>
          <button
            onClick={() => {
              setFrom(daysAgo(30));
              setTo("");
            }}
            className="btn btn-ghost px-3 py-2 text-[12.5px]"
          >
            30 дней
          </button>
          <button
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="btn btn-ghost px-3 py-2 text-[12.5px]"
          >
            Всё время
          </button>
        </div>
        <label className="block">
          <span className={lbl}>Расход на рекламу за период, ₽</span>
          <input id="at-spend" inputMode="decimal" value={spend} onChange={(e) => setSpendSaved(e.target.value)} placeholder="например 32455" className="input-blank mt-1.5 block w-44 rounded-sm px-2.5 py-2 text-[13px]" />
        </label>
      </div>

      {loading && !report ? (
        <p className="font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      ) : !report || !t ? (
        <p className="text-[13px] text-red">Не удалось загрузить отчёт.</p>
      ) : (
        <>
          {spendNum > 0 && t.regs > 0 && (
            <div className="grid gap-2 border-2 border-ink/15 p-3 text-[13px] sm:grid-cols-5" aria-label="Стоимость этапов">
              {(
                [
                  ["регистрацию", t.regs],
                  ["подтверждение почты", t.confirmed],
                  ["диагностику", t.diagnostic],
                  ["действие в сервисе", t.active],
                  ["оплату", t.paid],
                ] as const
              ).map(([name, n]) => (
                <div key={name}>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink2">за {name}</p>
                  <p className="font-display text-[17px] font-black">{n ? money(spendNum / n) : "—"}</p>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto border-2 border-ink/15">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead>
                <tr className="border-b-2 border-ink/15">
                  <th className={`${th} text-left`}>Канал</th>
                  <th className={`${th} text-left`}>Кампания</th>
                  <th className={th}>Рег.</th>
                  <th className={th}>Почта</th>
                  <th className={th}>Онбординг</th>
                  <th className={th}>Диагностика</th>
                  <th className={th}>Действие</th>
                  <th className={th}>Оплат</th>
                  <th className={th}>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.channel}|${r.campaign}`} className="border-b border-ink/10">
                    <td className="px-2.5 py-2 font-bold">{r.channel}</td>
                    <td className="px-2.5 py-2 font-mono text-[12px]">{r.campaign}</td>
                    <td className={td}>{r.regs}</td>
                    <td className={td}>
                      {r.confirmed} <span className="text-ink2">({pct(r.confirmed, r.regs)})</span>
                    </td>
                    <td className={td}>
                      {r.onboarded} <span className="text-ink2">({pct(r.onboarded, r.regs)})</span>
                    </td>
                    <td className={td}>
                      {r.diagnostic} <span className="text-ink2">({pct(r.diagnostic, r.regs)})</span>
                    </td>
                    <td className={td}>
                      {r.active} <span className="text-ink2">({pct(r.active, r.regs)})</span>
                    </td>
                    <td className={td}>{r.paid}</td>
                    <td className={td}>{r.revenue ? money(r.revenue) : "—"}</td>
                  </tr>
                ))}
                <tr className="bg-ink/5 font-bold">
                  <td className="px-2.5 py-2" colSpan={2}>
                    Итого
                  </td>
                  <td className={td}>{t.regs}</td>
                  <td className={td}>
                    {t.confirmed} ({pct(t.confirmed, t.regs)})
                  </td>
                  <td className={td}>
                    {t.onboarded} ({pct(t.onboarded, t.regs)})
                  </td>
                  <td className={td}>
                    {t.diagnostic} ({pct(t.diagnostic, t.regs)})
                  </td>
                  <td className={td}>
                    {t.active} ({pct(t.active, t.regs)})
                  </td>
                  <td className={td}>{t.paid}</td>
                  <td className={td}>{t.revenue ? money(t.revenue) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <section aria-labelledby="at-domains">
            <h3 id="at-domains" className="font-display text-[15px] font-black">
              Подтверждение почты по сервисам
            </h3>
            <p className="mt-1 text-[12.5px] text-ink2">Если у одного сервиса доля заметно ниже остальных, письма с подтверждением до него, скорее всего, не доходят или попадают в спам.</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {report.domains.map((d) => {
                const share = d.regs ? d.confirmed / d.regs : 0;
                return (
                  <li key={d.domain} className="flex items-baseline justify-between border-2 border-ink/15 px-3 py-2 text-[13px]">
                    <span className="font-bold">{d.domain}</span>
                    <span className={`tabular-nums ${share < 0.6 ? "font-bold text-red" : ""}`}>
                      {d.confirmed} из {d.regs} · {pct(d.confirmed, d.regs)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section className="border-2 border-dashed border-ink/25 p-4" aria-labelledby="at-utm">
        <h3 id="at-utm" className="font-display text-[15px] font-black">
          Метки для Яндекс Директа
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
          Чтобы кампании различались в отчёте, добавьте этот шаблон в «Параметры URL» кампании или группы в Директе. Макросы{" "}
          <code className="font-mono">{"{campaign_id}"}</code>, <code className="font-mono">{"{ad_id}"}</code> и <code className="font-mono">{"{keyword}"}</code> Директ подставит сам.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-sm bg-ink/5 px-2 py-1.5 font-mono text-[12px]">{DIRECT_UTM_TEMPLATE}</code>
          <button onClick={copyTemplate} className="btn btn-ghost px-3 py-1.5 text-[12px]">
            Копировать
          </button>
        </div>
      </section>
    </div>
  );
}
