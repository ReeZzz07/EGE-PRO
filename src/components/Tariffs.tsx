// Публичная страница тарифов (см. docs/tarifs.md) — видна и гостям (решают, регистрироваться
// ли), и авторизованным (могут сменить тариф). Оплаты нет: кнопка "Выбрать" — это прямой
// updateProfile({tariffId}), без списания денег (см. комментарий в supabase/migrations/0009_tariffs.sql).
// Администраторы тариф не выбирают вообще — у них полный доступ независимо от tariff_id в БД.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { DEFAULT_SEO, loadSeoSettings } from "../lib/seo";
import { DEFAULT_TARIFFS_CONTENT, loadTariffsContent, type TariffsPageContent } from "../lib/tariffsContent";
import { useDocumentHead } from "../lib/useDocumentHead";
import { Icon, useToast } from "./ui";
import { MySubjectsSection } from "./Dashboard";
import type { View } from "./Header";

function money(rub: number): string {
  if (rub === 0) return "Бесплатно";
  return `${rub.toLocaleString("ru-RU")} ₽/мес`;
}

export default function Tariffs({ onNav }: { onNav: (v: View) => void }) {
  const { profile, updateProfile, deleteAccount, isGuestMode } = useAuth();
  const { push } = useToast();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [seo, setSeo] = useState(DEFAULT_SEO);
  const [content, setContent] = useState<TariffsPageContent>(DEFAULT_TARIFFS_CONTENT);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cancelDelete = () => {
    setConfirmingDelete(false);
    setDeletePassword("");
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!isGuestMode && !deletePassword.trim()) return setDeleteError("Введи пароль, чтобы подтвердить удаление.");
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteAccount(deletePassword);
    setDeleting(false);
    if (res.error) return setDeleteError(res.error);
    onNav({ name: "landing" });
  };

  useEffect(() => {
    loadActiveTariffs().then((t) => {
      setTariffs(t);
      setLoading(false);
    });
    loadSeoSettings().then(setSeo);
    loadTariffsContent().then(setContent);
  }, []);

  useDocumentHead({ ...seo.pages.tariffs, path: "/tariffs", ogImage: seo.ogImage });

  const choose = async (t: Tariff) => {
    if (!profile) {
      onNav({ name: "auth", mode: "signup" });
      return;
    }
    setSwitching(t.id);
    await updateProfile({ tariffId: t.id });
    setSwitching(null);
    push(t.priceRub === 0 ? "Готово — активирован бесплатный тариф" : `Готово — тариф «${t.name}» активирован`, "ok");
  };

  if (loading) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка тарифов…</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <div className="mt-8 text-center sm:mt-12">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">{content.eyebrow}</p>
        <h1 className="font-display mt-2 text-2xl font-black sm:text-3xl">{content.title}</h1>
        <p className="mx-auto mt-2 max-w-lg text-[13.5px] text-ink2">{content.subtitle}</p>
        {tariffs.some((t) => t.priceRub > 0) && <p className="mt-1 font-mono text-[11.5px] text-ink2">{content.perSubjectNote}</p>}
      </div>

      {profile?.isAdmin && (
        <p className="mt-6 border-l-4 border-blue bg-blue/8 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Ты администратор</strong> — тарифы тебя не ограничивают, доступ ко всем предметам и функциям есть в любом случае.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tariffs.map((t) => {
          const isCurrent = profile?.tariffId === t.id;
          const isPopular = !!t.badge && t.priceRub > 0;
          return (
            <div
              key={t.id}
              className={`sheet card-lift relative flex flex-col p-5 ${isPopular ? "border-2 border-blue" : ""}`}
            >
              {t.badge && (
                <span className={`absolute -top-3 left-4 rounded-sm border-2 px-2 py-0.5 font-mono text-[10.5px] font-bold ${isPopular ? "border-blue bg-blue text-white" : "border-ink bg-hl text-ink"}`}>
                  {t.badge}
                </span>
              )}
              <h2 className="font-display mt-2 text-lg font-black">{t.name}</h2>
              {t.salePriceRub != null ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="font-display text-2xl font-black">{money(t.salePriceRub)}</p>
                  <p className="font-mono text-[13px] text-ink2 line-through">{money(t.priceRub)}</p>
                  <span className="rounded-sm bg-red px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-white">
                    −{Math.round((1 - t.salePriceRub / t.priceRub) * 100)}%
                  </span>
                </div>
              ) : (
                <p className="font-display mt-2 text-2xl font-black">{money(t.priceRub)}</p>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-[13px] text-ink2">
                {(t.features.length > 0
                  ? t.features
                  : [
                      `${t.subjectsCount} ${t.subjectsCount === 1 ? "предмет" : t.subjectsCount < 5 ? "предмета" : "предметов"} на выбор`,
                      t.dailyAiLimit != null ? `до ${t.dailyAiLimit} обращений к ИИ-репетитору в день` : "Безлимитный ИИ-репетитор",
                      "Диагностика, план, пробные варианты",
                    ]
                ).map((feat, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-blue" />
                    {feat}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => choose(t)}
                disabled={isCurrent || switching === t.id}
                className={`mt-5 w-full justify-center px-4 py-2.5 text-[13px] ${isCurrent ? "btn btn-ghost" : "btn btn-ink"}`}
              >
                {isCurrent ? "Текущий тариф" : switching === t.id ? "Применяем…" : profile ? "Выбрать" : "Начать"}
              </button>
            </div>
          );
        })}
      </div>

      {/* управление предметами живёт здесь, а не на главной — лимит "N предметов на выбор" как
          раз то, что решается на этой странице (см. MySubjectsSection в Dashboard.tsx) */}
      {profile && <MySubjectsSection onNav={onNav} />}

      {profile && (
        <section className="mt-14 border-t-2 border-dashed border-red/30 pt-8">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-red">опасная зона</p>
          <h2 className="font-display mt-1 text-xl font-black">Удалить аккаунт</h2>
          <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-ink2">
            Профиль, подключённые предметы, попытки решений, диагностика, план подготовки и история чата с
            ИИ-репетитором будут удалены безвозвратно.
          </p>

          {!confirmingDelete ? (
            <button onClick={() => setConfirmingDelete(true)} className="btn btn-ghost mt-4 px-4 py-2.5 text-[13px] text-red">
              <Icon name="trash" size={14} /> Удалить аккаунт
            </button>
          ) : (
            <div className="sheet mt-4 max-w-sm border-red/40 p-5">
              {isGuestMode ? (
                <p className="text-[13px] leading-relaxed text-ink2">Гостевой профиль в этом браузере будет удалён без возможности восстановления.</p>
              ) : (
                <>
                  <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Подтверди паролем</label>
                  <div className="relative mt-1.5">
                    <input
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      type={showDeletePassword ? "text" : "password"}
                      onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
                      className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
                      placeholder="Текущий пароль"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDeletePassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-ink2 hover:text-ink"
                      aria-label={showDeletePassword ? "Скрыть пароль" : "Показать пароль"}
                    >
                      <Icon name={showDeletePassword ? "eyeOff" : "eye"} size={16} />
                    </button>
                  </div>
                </>
              )}

              {deleteError && (
                <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
                  <Icon name="alert" size={15} /> {deleteError}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2.5">
                <button onClick={confirmDelete} disabled={deleting} className="btn btn-red px-4 py-2.5 text-[13px]">
                  {deleting ? "Удаляем…" : "Да, удалить навсегда"}
                </button>
                <button onClick={cancelDelete} className="btn btn-ghost px-4 py-2.5 text-[13px]">Отмена</button>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="mt-8 text-center text-[12px] text-ink2">{content.paymentNote}</p>
      <p className="mt-2 text-center text-[12px] text-ink2">
        Выбирая платный тариф, ты соглашаешься с{" "}
        <button onClick={() => onNav({ name: "legal", doc: "offer" })} className="link-slide font-bold text-ink2 hover:text-ink">
          публичной офертой
        </button>{" "}
        и{" "}
        <button onClick={() => onNav({ name: "legal", doc: "privacy" })} className="link-slide font-bold text-ink2 hover:text-ink">
          политикой конфиденциальности
        </button>
      </p>
    </div>
  );
}
