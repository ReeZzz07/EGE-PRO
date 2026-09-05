// Профиль — личная карточка ученика: имя/email/аватар (редактируется здесь) плюс информационные
// плитки, собирающие в одном месте самое важное с других страниц аккаунта (тариф и предметы — из
// SubjectsView.tsx, класс/цель — из SettingsView.tsx, баллы — из StatsView, ошибки — из
// MistakesView) со ссылками на них. Сам контент этих страниц не дублируется, только сводка.
// Смена пароля — на странице "Настройки" (SettingsView.tsx), рядом с опасной зоной.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { useProgress } from "../lib/store";
import { GOAL_OPTS, GRADE_OPTS } from "./OnboardingFlow";
import { loadActiveTariffs, type Tariff } from "../lib/tariffs";
import { getGlobalPointsTotal, getSubjectsPointsTotal } from "../lib/dbTasks";
import { AVATAR_PRESETS, photoUrlFromAvatarUrl, presetFromAvatarUrl, removeUploadedAvatar, uploadAvatar } from "../lib/avatar";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

function formatJoinDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function FactTile({ icon, label, value, accent, onClick }: { icon: string; label: string; value: string; accent?: "red" | "blue"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="sheet card-lift flex flex-col items-start gap-1.5 p-4 text-left">
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink2">
        <Icon name={icon} size={12} /> {label}
      </span>
      <span className={`font-display text-[15px] font-black leading-tight ${accent === "red" ? "text-red" : accent === "blue" ? "text-blue" : ""}`}>{value}</span>
    </button>
  );
}

export default function ProfileView({ onNav }: { onNav: (v: View) => void }) {
  const { profile, updateProfile, changeEmail, setAvatar, isGuestMode } = useAuth();
  const { derived } = useProgress();
  const { push } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState(profile?.email ?? "");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    loadActiveTariffs().then(setTariffs);
  }, []);

  if (!profile) return null;

  const dirty = name !== profile.name;

  const save = async () => {
    setSaving(true);
    await updateProfile({ name: name.trim() });
    setSaving(false);
    push("Изменения сохранены", "ok");
  };

  const choosePreset = async (id: string) => {
    setAvatarBusy(true);
    setAvatarError(null);
    await setAvatar(`preset:${id}`);
    setAvatarBusy(false);
    setPickerOpen(false);
    push("Аватар обновлён", "ok");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError(null);
    const res = await uploadAvatar(file);
    if (res.error) {
      setAvatarBusy(false);
      setAvatarError(res.error);
      return;
    }
    await setAvatar(res.path!);
    setAvatarBusy(false);
    setPickerOpen(false);
    push("Фото обновлено", "ok");
  };

  const handleRemoveAvatar = async () => {
    setAvatarBusy(true);
    setAvatarError(null);
    if (profile.avatarUrl && !profile.avatarUrl.startsWith("preset:")) {
      const res = await removeUploadedAvatar();
      if (res.error) {
        setAvatarBusy(false);
        setAvatarError(res.error);
        return;
      }
    }
    await setAvatar(null);
    setAvatarBusy(false);
    push("Аватар сброшен", "ok");
  };

  const startEditEmail = () => {
    setNewEmail(profile.email);
    setEmailPassword("");
    setEmailError(null);
    setEditingEmail(true);
  };

  const saveEmail = async () => {
    if (!newEmail.trim() || !emailPassword.trim()) return setEmailError("Заполни новый email и текущий пароль.");
    setEmailSaving(true);
    setEmailError(null);
    const res = await changeEmail(emailPassword, newEmail.trim());
    setEmailSaving(false);
    if (res.error) return setEmailError(res.error);
    setEditingEmail(false);
    push("Email изменён", "ok");
  };

  const tariff = tariffs.find((t) => t.id === profile.tariffId);
  const gradeLabel = GRADE_OPTS.find((o) => o.v === profile.grade)?.l ?? "не указан";
  const goalLabel = GOAL_OPTS.find((o) => o.v === profile.goal)?.l ?? "не указана";
  const initial = (profile.name || profile.email || "?").trim().charAt(0).toUpperCase();
  const mistakeCount = derived.mistakeIds.size;
  const preset = presetFromAvatarUrl(profile.avatarUrl);
  const photoUrl = photoUrlFromAvatarUrl(profile.avatarUrl);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">профиль</p>
      <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Личные данные</h1>

      {/* карточка личности */}
      <section className="sheet mt-6 flex flex-wrap items-start gap-5 p-5 sm:p-6">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          title="Сменить аватар"
          className={`group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border-2 border-ink ${
            photoUrl ? "" : preset ? preset.bg : "bg-ink"
          }`}
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : preset ? (
            <Icon name={preset.icon} size={28} className="text-white" />
          ) : (
            <span className="font-display text-2xl font-black text-hl">{initial}</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-ink/60 opacity-0 transition-opacity group-hover:opacity-100">
            <Icon name="gear" size={16} className="text-white" />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-xl font-black">{profile.name || "Без имени"}</h2>
          <p className="mt-0.5 truncate text-[13px] text-ink2">{profile.email}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {profile.isAdmin && (
              <span className="rounded-sm border-2 border-ink bg-hl px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em]">администратор</span>
            )}
            {profile.onboardedAt && (
              <span className="rounded-sm border-2 border-ink/15 px-2 py-0.5 font-mono text-[10.5px] font-bold text-ink2">
                с нами с {formatJoinDate(profile.onboardedAt)}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* пикер аватара */}
      {pickerOpen && (
        <section className="sheet mt-3 p-4 sm:p-5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">выбери аватар</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {AVATAR_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => choosePreset(p.id)}
                disabled={avatarBusy}
                title={p.id}
                className={`flex h-11 w-11 items-center justify-center border-2 ${p.bg} ${
                  profile.avatarUrl === `preset:${p.id}` ? "border-ink ring-2 ring-blue ring-offset-2" : "border-transparent"
                }`}
              >
                <Icon name={p.icon} size={18} className="text-white" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button onClick={() => fileInputRef.current?.click()} disabled={avatarBusy} className="btn btn-ghost px-3.5 py-2 text-[12.5px]">
              <Icon name="upload" size={14} /> Загрузить фото
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleFileChange} />
            {profile.avatarUrl && (
              <button onClick={handleRemoveAvatar} disabled={avatarBusy} className="btn btn-ghost px-3.5 py-2 text-[12.5px] text-red">
                Убрать аватар
              </button>
            )}
            {avatarBusy && <span className="font-mono text-[11.5px] text-ink2">Секунду…</span>}
          </div>
          {avatarError && (
            <p className="anim-rise mt-3 flex items-center gap-2 text-[13px] font-bold text-red">
              <Icon name="alert" size={15} /> {avatarError}
            </p>
          )}
        </section>
      )}

      {/* сводка по аккаунту — со ссылками на страницы, где это редактируется/подробнее */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FactTile
          icon="spark"
          label="тариф"
          value={profile.isAdmin ? "не ограничен" : tariff?.name ?? "…"}
          onClick={() => onNav({ name: "subjects" })}
        />
        <FactTile
          icon="book"
          label="предметы"
          value={profile.isAdmin ? `${profile.subjects.length}` : `${profile.subjects.length} из ${tariff?.subjectsCount ?? "?"}`}
          onClick={() => onNav({ name: "subjects" })}
        />
        <FactTile icon="target" label="класс" value={gradeLabel} onClick={() => onNav({ name: "settings" })} />
        <FactTile icon="flame" label="цель" value={goalLabel} onClick={() => onNav({ name: "settings" })} />
        <FactTile
          icon="star"
          label="баллы"
          value={`${derived.earnedPoints} из ${profile.isAdmin || isGuestMode ? getGlobalPointsTotal() : getSubjectsPointsTotal(profile.subjects)}`}
          accent="blue"
          onClick={() => onNav({ name: "stats" })}
        />
        <FactTile
          icon="alert"
          label="ошибки"
          value={mistakeCount > 0 ? `${mistakeCount} в тетради` : "тетрадь пуста"}
          accent={mistakeCount > 0 ? "red" : undefined}
          onClick={() => onNav({ name: "mistakes" })}
        />
      </div>

      {/* имя */}
      <section className="sheet mt-8 space-y-3 p-5 sm:p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">изменить</p>
        <div>
          <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Имя</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm" placeholder="Как к тебе обращаться" />
        </div>
        <button onClick={save} disabled={!dirty || saving || !name.trim()} className="btn btn-blue px-5 py-2.5 text-sm">
          {saving ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      </section>

      {/* email — смена требует пароль (см. server.js POST /auth/change-email) */}
      <section className="sheet mt-4 space-y-3 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <label className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Email</label>
          {!editingEmail && (
            <button onClick={startEditEmail} className="link-slide font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-blue">
              изменить
            </button>
          )}
        </div>

        {!editingEmail ? (
          <p className="rounded-sm border-2 border-ink/10 bg-ink/5 px-3.5 py-2.5 text-sm text-ink2">{profile.email}</p>
        ) : (
          <div className="space-y-3">
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              className="input-blank w-full rounded-sm px-3.5 py-2.5 text-sm"
              placeholder="Новый email"
            />
            <input
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              type="password"
              onKeyDown={(e) => e.key === "Enter" && saveEmail()}
              className="input-blank w-full rounded-sm px-3.5 py-2.5 text-sm"
              placeholder="Текущий пароль — для подтверждения"
            />
            {emailError && (
              <p className="anim-rise flex items-center gap-2 text-[13px] font-bold text-red">
                <Icon name="alert" size={15} /> {emailError}
              </p>
            )}
            <div className="flex flex-wrap gap-2.5">
              <button onClick={saveEmail} disabled={emailSaving} className="btn btn-blue px-5 py-2.5 text-sm">
                {emailSaving ? "Сохраняем…" : "Сохранить email"}
              </button>
              <button onClick={() => setEditingEmail(false)} className="btn btn-ghost px-4 py-2.5 text-sm">
                Отмена
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
