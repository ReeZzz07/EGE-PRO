// Публичная страница тарифов (см. docs/tarifs.md) — видна и гостям (решают, регистрироваться
// ли), и авторизованным (могут сменить тариф). Бесплатный тариф — прямой updateProfile({tariffId}),
// без денег; платный — разовая оплата через ЮKassa (см. lib/payments.ts, PaymentReturnView.tsx):
// кнопка создаёт платёж и уводит на страницу подтверждения ЮKassa, tariff_id/tariff_expires_at
// профилю выставляет вебхук на сервере (docker/api/payments.js) уже после реальной оплаты, а не
// эта кнопка напрямую.
// Администраторы тариф не выбирают вообще — у них полный доступ независимо от tariff_id в БД.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { DEFAULT_SEO, loadSeoSettings } from "../lib/seo";
import { DEFAULT_TARIFFS_CONTENT, loadTariffsContent, type TariffsPageContent } from "../lib/tariffsContent";
import { createPayment } from "../lib/payments";
import { reachGoal } from "../lib/metrika";
import { useDocumentHead } from "../lib/useDocumentHead";
import { plural } from "../lib/utils";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

export function money(rub: number): string {
  if (rub === 0) return "Бесплатно";
  return `${rub.toLocaleString("ru-RU")} ₽/мес`;
}

export default function Tariffs({ onNav }: { onNav: (v: View) => void }) {
  const { profile, updateProfile } = useAuth();
  const { push } = useToast();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [seo, setSeo] = useState(DEFAULT_SEO);
  const [content, setContent] = useState<TariffsPageContent>(DEFAULT_TARIFFS_CONTENT);

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
    if (t.priceRub === 0) {
      setSwitching(t.id);
      await updateProfile({ tariffId: t.id });
      setSwitching(null);
      push("Готово — активирован бесплатный тариф", "ok");
      return;
    }
    setSwitching(t.id);
    const res = await createPayment(t.id);
    setSwitching(null);
    if (res.error) return push(res.error, "err");
    if (res.confirmationUrl) {
      // редирект — только после того, как Метрика приняла событие (или через 1 с): иначе уход со
      // страницы обрывал бы отправку цели
      const url = res.confirmationUrl;
      reachGoal("checkout_start", { tariff: t.id, price: t.priceRub }, () => {
        window.location.href = url;
      });
    }
  };

  const discountedPrice = (priceRub: number) => (profile?.discountPercent ? Math.round(priceRub * (1 - profile.discountPercent / 100) * 100) / 100 : null);

  if (loading) {
    return <p className="py-16 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка тарифов…</p>;
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-20">
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
              {t.priceRub > 0 && discountedPrice(t.salePriceRub ?? t.priceRub) != null && (
                <p className="mt-1 font-mono text-[12px] font-bold text-teal">
                  К оплате с твоей скидкой −{profile!.discountPercent}%: {money(discountedPrice(t.salePriceRub ?? t.priceRub)!)}
                </p>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-[13px] text-ink2">
                {(t.features.length > 0
                  ? t.features
                  : [
                      `${t.subjectsCount} ${plural(t.subjectsCount, "предмет", "предмета", "предметов")} на выбор`,
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
                {isCurrent ? "Текущий тариф" : switching === t.id ? "Открываем оплату…" : profile ? "Выбрать" : "Начать"}
              </button>
              {isCurrent && t.priceRub > 0 && profile?.tariffExpiresAt && (
                <p className="mt-2 text-center font-mono text-[11px] text-ink2">
                  Оплачено до {new Date(profile.tariffExpiresAt).toLocaleDateString("ru-RU")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* управление предметами и удаление аккаунта — на странице профиля (см. ProfileView.tsx),
          рядом с остальными личными настройками, а не здесь */}
      {profile && (
        <p className="mt-8 text-center text-[12.5px] text-ink2">
          {profile.isAdmin ? (
            <>
              <strong className="text-ink">Ты администратор</strong> — тариф не ограничивает число предметов, подключено {profile.subjects.length}.
            </>
          ) : (
            <>Подключено {profile.subjects.length} из {tariffs.find((t) => t.id === profile.tariffId)?.subjectsCount ?? "?"} предметов.</>
          )}{" "}
          <button onClick={() => onNav({ name: "subjects" })} className="link-slide font-bold text-ink2 hover:text-ink">
            управлять в «Мои предметы»
          </button>
        </p>
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
