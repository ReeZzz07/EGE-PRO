// CRUD тарифов (public.tariffs) — добавление/редактирование/удаление, видно только админу
// (RLS в supabase/migrations/0009_tariffs.sql). Удаление тарифа, на котором ещё есть пользователи,
// заблокировано внешним ключом profiles.tariff_id — deleteTariff() возвращает понятную ошибку.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import { loadAllTariffs, createTariff, updateTariff, deleteTariff, type Tariff, type TariffInput } from "../lib/tariffs";
import { DEFAULT_TARIFFS_CONTENT, loadTariffsContent, saveTariffsContent, type TariffsPageContent } from "../lib/tariffsContent";
import { Icon, useToast } from "./ui";

function TariffsPageTextCard() {
  const { profile } = useAuth();
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState<TariffsPageContent>(DEFAULT_TARIFFS_CONTENT);

  useEffect(() => {
    loadTariffsContent().then((c) => {
      setContent(c);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const res = await saveTariffsContent(content, profile.id);
    setSaving(false);
    if (res.error) push(res.error, "err");
    else push("Сохранено — обновится при следующем открытии страницы тарифов", "ok");
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <div className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Текст страницы тарифов</h2>
          <p className="mt-1 text-[12.5px] text-ink2">Всё вокруг карточек тарифов — эйбрау над заголовком, заголовок, подзаголовок и заметки под карточками.</p>
        </div>
        <button onClick={() => setContent(DEFAULT_TARIFFS_CONTENT)} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          <Icon name="refresh" size={14} /> К дефолту
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Эйбрау (маленькая надпись над заголовком)</span>
          <input
            value={content.eyebrow}
            onChange={(e) => setContent((c) => ({ ...c, eyebrow: e.target.value }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Заголовок</span>
          <input
            value={content.title}
            onChange={(e) => setContent((c) => ({ ...c, title: e.target.value }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Подзаголовок</span>
          <textarea
            value={content.subtitle}
            onChange={(e) => setContent((c) => ({ ...c, subtitle: e.target.value }))}
            rows={2}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Заметка про поштучную цену <span className="font-normal normal-case">— видна, только если среди активных тарифов есть хоть один платный</span>
          </span>
          <input
            value={content.perSubjectNote}
            onChange={(e) => setContent((c) => ({ ...c, perSubjectNote: e.target.value }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Заметка про оплату (под карточками)</span>
          <textarea
            value={content.paymentNote}
            onChange={(e) => setContent((c) => ({ ...c, paymentNote: e.target.value }))}
            rows={2}
            className="input-blank mt-1.5 w-full resize-y rounded-sm px-3 py-2 text-[13px]"
          />
        </label>
      </div>

      <button onClick={save} disabled={saving} className="btn btn-blue mt-4 px-5 py-2.5 text-[13px]">
        <Icon name="check" size={14} /> {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}

const EMPTY_FORM: TariffInput = { id: "", name: "", badge: null, priceRub: 0, salePriceRub: null, subjectsCount: 1, dailyAiLimit: null, features: [], sortOrder: 0, isActive: true };

function TariffForm({ initial, isNew, onCancel, onSave, saving }: { initial: TariffInput; isNew: boolean; onCancel: () => void; onSave: (v: TariffInput) => void; saving: boolean }) {
  const [form, setForm] = useState<TariffInput>(initial);
  return (
    <div className="border-2 border-dashed border-ink/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">
            Код (id) {!isNew && <span className="font-normal normal-case">— нельзя изменить</span>}
          </span>
          <input
            value={form.id}
            disabled={!isNew}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
            placeholder="vuz-plus"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px] disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Название</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ВУЗ+" className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Бейдж (необязательно)</span>
          <input
            value={form.badge ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value || null }))}
            placeholder="🔥 Популярный выбор"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 text-[13.5px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Цена, ₽/мес (0 — бесплатно)</span>
          <input
            type="number"
            min={0}
            value={form.priceRub}
            onChange={(e) => setForm((f) => ({ ...f, priceRub: Math.max(0, Number(e.target.value) || 0) }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Цена со скидкой, ₽/мес (пусто — без скидки)</span>
          <input
            type="number"
            min={0}
            value={form.salePriceRub ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, salePriceRub: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
            placeholder="без скидки"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
          {form.salePriceRub != null && form.salePriceRub >= form.priceRub && (
            <span className="mt-1 block text-[11.5px] font-bold text-red">Должна быть меньше обычной цены ({form.priceRub.toLocaleString("ru-RU")} ₽)</span>
          )}
          {form.salePriceRub != null && form.salePriceRub < form.priceRub && form.priceRub > 0 && (
            <span className="mt-1 block text-[11.5px] text-ink2">
              Покажется: <s>{form.priceRub.toLocaleString("ru-RU")} ₽</s> → {form.salePriceRub.toLocaleString("ru-RU")} ₽ (−{Math.round((1 - form.salePriceRub / form.priceRub) * 100)}%)
            </span>
          )}
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Предметов на выбор</span>
          <input
            type="number"
            min={1}
            value={form.subjectsCount}
            onChange={(e) => setForm((f) => ({ ...f, subjectsCount: Math.max(1, Number(e.target.value) || 1) }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Лимит ИИ-запросов в день (пусто — безлимит)</span>
          <input
            type="number"
            min={0}
            value={form.dailyAiLimit ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, dailyAiLimit: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) }))}
            placeholder="безлимит"
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Порядок сортировки</span>
          <input
            type="number"
            value={form.sortOrder ?? 0}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
            className="input-blank mt-1.5 w-full rounded-sm px-3 py-2 font-mono text-[13px]"
          />
        </label>
        <label className="mt-1 flex items-center gap-2">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4" />
          <span className="text-[13px] font-bold">Активен (виден на публичной странице тарифов)</span>
        </label>
      </div>

      <div className="mt-4">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink2">Список преимуществ (пункты со значком-галочкой на странице тарифов)</span>
        <div className="mt-1.5 space-y-2">
          {form.features.map((feat, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={feat}
                onChange={(e) => setForm((f) => ({ ...f, features: f.features.map((x, j) => (j === i ? e.target.value : x)) }))}
                placeholder="Например: 4 предмета на выбор"
                className="input-blank flex-1 rounded-sm px-3 py-2 text-[13px]"
              />
              <button onClick={() => setForm((f) => ({ ...f, features: f.features.filter((_, j) => j !== i) }))} className="btn btn-ghost px-2.5 py-2 text-[11px]">
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setForm((f) => ({ ...f, features: [...f.features, ""] }))}
          className="btn btn-ghost mt-2 w-full justify-center px-3 py-2 text-[12.5px]"
        >
          + Добавить пункт
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onSave({ ...form, features: form.features.map((f) => f.trim()).filter(Boolean) })}
          disabled={saving || !form.id.trim() || !form.name.trim() || (form.salePriceRub != null && form.salePriceRub >= form.priceRub)}
          className="btn btn-blue px-4 py-2 text-[12.5px] disabled:opacity-50"
        >
          <Icon name="check" size={13} /> {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        <button onClick={onCancel} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function AdminTariffs() {
  const { push } = useToast();
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = () => loadAllTariffs().then((t) => { setTariffs(t); setLoading(false); });
  useEffect(() => { refresh(); }, []);

  const saveEdit = async (v: TariffInput) => {
    setSaving(true);
    const res = await updateTariff(v.id, v);
    setSaving(false);
    if (res.error) { push(res.error, "err"); return; }
    push("Тариф обновлён", "ok");
    setEditingId(null);
    refresh();
  };

  const saveNew = async (v: TariffInput) => {
    if (tariffs.some((t) => t.id === v.id)) { push("Тариф с таким кодом уже существует", "err"); return; }
    setSaving(true);
    const res = await createTariff(v);
    setSaving(false);
    if (res.error) { push(res.error, "err"); return; }
    push("Тариф добавлен", "ok");
    setAddingNew(false);
    refresh();
  };

  const remove = async (id: string) => {
    const res = await deleteTariff(id);
    if (res.error) { push(res.error, "err"); return; }
    push("Тариф удалён", "ok");
    refresh();
  };

  if (loading) {
    return <p className="py-8 text-center font-mono text-[12.5px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>;
  }

  return (
    <>
    <TariffsPageTextCard />
    <div className="sheet mt-6 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">Тарифы</h2>
      <p className="mt-1 text-[12.5px] text-ink2">
        Видны на публичной странице «Тарифы», если активны. Оплаты пока нет — выбор тарифа пользователем просто записывает код тарифа в профиль.
      </p>

      {!isSupabaseConfigured && (
        <p className="mt-4 border-l-4 border-amber bg-amber/10 px-4 py-3 text-[13px] leading-relaxed text-ink2">
          <strong className="text-ink">Бэкенд не подключён:</strong> изменения нигде не сохранятся — это только предпросмотр формы.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {tariffs.map((t) =>
          editingId === t.id ? (
            <TariffForm key={t.id} initial={t} isNew={false} saving={saving} onCancel={() => setEditingId(null)} onSave={saveEdit} />
          ) : (
            <div key={t.id} className={`flex flex-wrap items-center justify-between gap-3 border-2 p-4 ${t.isActive ? "border-ink/15" : "border-ink/10 opacity-50"}`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-[15px] font-bold">{t.name}</span>
                  {t.badge && <span className="rounded-sm border-2 border-ink bg-hl px-1.5 py-0.5 font-mono text-[10px] font-bold">{t.badge}</span>}
                  {!t.isActive && <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink2">скрыт</span>}
                </div>
                <p className="mt-1 font-mono text-[11.5px] text-ink2">
                  {t.priceRub === 0 ? (
                    "бесплатно"
                  ) : t.salePriceRub != null ? (
                    <>
                      <s>{t.priceRub.toLocaleString("ru-RU")} ₽</s> → <span className="font-bold text-ink">{t.salePriceRub.toLocaleString("ru-RU")} ₽/мес</span> (−{Math.round((1 - t.salePriceRub / t.priceRub) * 100)}%)
                    </>
                  ) : (
                    `${t.priceRub.toLocaleString("ru-RU")} ₽/мес`
                  )}{" "}
                  · {t.subjectsCount} предм. · {t.dailyAiLimit != null ? `${t.dailyAiLimit} ИИ-запросов/день` : "безлимит ИИ"} · код: {t.id}
                </p>
                {t.features.length > 0 && <p className="mt-1 text-[11.5px] text-ink2">✓ {t.features.join(" · ")}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingId(t.id)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  <Icon name="refresh" size={13} /> Редактировать
                </button>
                <button onClick={() => remove(t.id)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                  <Icon name="trash" size={13} /> Удалить
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <div className="mt-4">
        {addingNew ? (
          <TariffForm initial={EMPTY_FORM} isNew saving={saving} onCancel={() => setAddingNew(false)} onSave={saveNew} />
        ) : (
          <button onClick={() => setAddingNew(true)} className="btn btn-ghost w-full justify-center px-4 py-2.5 text-[13px]">
            + Добавить тариф
          </button>
        )}
      </div>
    </div>
    </>
  );
}
