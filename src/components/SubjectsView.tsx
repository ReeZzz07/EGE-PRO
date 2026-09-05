// Мои предметы — сводка по тарифу (лимит предметов упирается именно в него) и сами подключённые
// предметы (MySubjectsSection, см. Dashboard.tsx). Личные данные — в "Профиль", подготовка и
// удаление аккаунта — в "Настройки" (см. ProfileView.tsx/SettingsView.tsx).
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { MySubjectsSection } from "./Dashboard";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { money } from "./Tariffs";
import type { View } from "./Header";

export default function SubjectsView({ onNav }: { onNav: (v: View) => void }) {
  const { profile } = useAuth();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

  useEffect(() => {
    loadActiveTariffs().then(setTariffs);
  }, []);

  if (!profile) return null;

  const tariff = tariffs.find((t) => t.id === profile.tariffId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">мои предметы</p>
      <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Что готовим</h1>

      {profile.isAdmin ? (
        <p className="mt-6 border-l-4 border-blue bg-blue/8 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Ты администратор</strong> — тариф не ограничивает число предметов.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-2 border-ink/15 bg-sheet px-4 py-3">
          <div>
            <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.2em] text-ink2">текущий тариф</p>
            <p className="font-display mt-0.5 text-base font-bold">{tariff ? `${tariff.name} · ${money(tariff.priceRub)}` : "…"}</p>
            {tariff && (
              <p className="mt-0.5 text-[12.5px] text-ink2">
                {profile.subjects.length} из {tariff.subjectsCount} предметов ·{" "}
                {tariff.dailyAiLimit != null ? `до ${tariff.dailyAiLimit} обращений к ИИ в день` : "безлимитный ИИ-репетитор"}
              </p>
            )}
          </div>
          <button onClick={() => onNav({ name: "tariffs" })} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">Сменить тариф</button>
        </div>
      )}

      <MySubjectsSection onNav={onNav} />

      <button
        onClick={() => onNav({ name: "kim2027" })}
        className="mt-8 flex w-full items-center justify-between gap-3 border-l-4 border-amber bg-amber/8 px-4 py-3 text-left transition hover:bg-amber/12"
      >
        <span className="text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Что меняется в ЕГЭ 2027</strong> — проект ФИПИ по математике, истории и информатике.
        </span>
        <span className="shrink-0 font-mono text-[12px] font-bold text-amber">Подробнее →</span>
      </button>
    </div>
  );
}
