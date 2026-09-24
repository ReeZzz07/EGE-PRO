// Админка → «Рассылки»: история рассылок по фильтру (кому, что, когда, сколько ушло, ошибки) и отмена идущих.
// Новую рассылку создают во вкладке «Пользователи»: задать фильтр → «Написать по фильтру».
import { Fragment, useCallback, useEffect, useState } from "react";
import { cancelCampaign, filtersFromServer, loadCampaign, loadCampaigns, type CampaignDetail, type CampaignSummary } from "../lib/campaigns";
import { describeFilters } from "./AdminUserFilterPanel";
import { CampaignProgress } from "./AdminCampaignComposer";
import { fmtDateTime } from "./AdminUserCard";
import { Icon, useToast } from "./ui";

const STATUS: Record<CampaignSummary["status"], { text: string; cls: string }> = {
  sending: { text: "идёт", cls: "border-blue bg-blue/10 text-blue" },
  done: { text: "завершена", cls: "border-teal bg-teal/10 text-teal" },
  cancelled: { text: "отменена", cls: "border-amber bg-amber/10 text-amber" },
};

function summarize(c: CampaignSummary): string {
  const chips = describeFilters(filtersFromServer(c.filters, c.q)).map((x) => x.text);
  if (c.q) chips.unshift(`Поиск: «${c.q}»`);
  return chips.length ? chips.join(" · ") : "без фильтра";
}

export default function AdminCampaigns() {
  const { push } = useToast();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(() => {
    loadCampaigns().then((res) => {
      if (res.error) return setError(res.error);
      setError(null);
      setCampaigns(res.campaigns ?? []);
    });
  }, []);

  useEffect(refresh, [refresh]);

  // пока есть идущие рассылки — обновляем список и открытую карточку
  const anySending = campaigns?.some((c) => c.status === "sending") ?? false;
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(() => {
      refresh();
      if (openId) loadCampaign(openId).then(setDetail);
    }, 2500);
    return () => clearInterval(t);
  }, [anySending, refresh, openId]);

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    loadCampaign(id).then(setDetail);
  };

  const cancel = async (id: string) => {
    setCancelling(true);
    const res = await cancelCampaign(id);
    setCancelling(false);
    if (res.error) push(res.error, "err");
    else push("Рассылка остановлена", "ok");
    refresh();
    loadCampaign(id).then(setDetail);
  };

  return (
    <div className="sheet p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Рассылки</h2>
      <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink2">
        История писем, отправленных из админки по фильтру. Чтобы написать пользователям: вкладка «Пользователи» → задай фильтр (например, «Подтвердил аккаунт — Нет») → «Написать по фильтру».
      </p>

      {error && (
        <p role="alert" className="mt-4 text-[13px] font-bold text-red">
          {error}
        </p>
      )}

      <div className="relative mt-4 overflow-x-auto border-2 border-ink/15">
        {campaigns === null ? (
          <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
        ) : campaigns.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink2">Рассылок пока не было.</p>
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="bg-sheet font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink2">
              <tr className="border-b-2 border-ink/15">
                <th className="px-3.5 py-2.5">Когда</th>
                <th className="px-3 py-2.5">Что и кому</th>
                <th className="px-3 py-2.5">Итог</th>
                <th className="px-3 py-2.5">Статус</th>
                <th className="px-3 py-2.5">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-ink/10">
              {campaigns.map((c) => {
                const st = STATUS[c.status];
                const open = openId === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr onClick={() => toggle(c.id)} className="cursor-pointer bg-paper align-top transition hover:bg-hl/40">
                      <td className="whitespace-nowrap px-3.5 py-3 font-mono text-[12px]">
                        {fmtDateTime(c.created_at)}
                        {c.created_by_email && <p className="mt-0.5 max-w-[160px] truncate text-[10.5px] text-ink2">{c.created_by_email}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-[13.5px] font-bold">{c.kind === "verify_link" ? "Ссылка подтверждения почты" : (c.subject ?? "—")}</p>
                        <p className="mt-0.5 max-w-[420px] text-[12px] text-ink2">{summarize(c)}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-[12px]">
                        <span className="text-teal">{c.sent}</span> из {c.total}
                        {c.failed > 0 && <span className="text-red"> · ошибок {c.failed}</span>}
                        {c.skipped > 0 && <span className="text-ink2"> · пропущено {c.skipped}</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-sm border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${st.cls}`}>{st.text}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Icon name="chevronDown" size={14} className={`inline transition ${open ? "rotate-180" : ""}`} />
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-white">
                        <td colSpan={5} className="px-4 py-4">
                          {detail ? <CampaignProgress detail={detail} onCancel={() => cancel(c.id)} cancelling={cancelling} /> : <p className="font-mono text-[12px] text-ink2">Загрузка…</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
