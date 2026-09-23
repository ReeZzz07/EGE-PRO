// Настройки — параметры подготовки (класс, год сдачи, цель, время в день; раньше задавались один
// раз на онбординге и больше нигде не редактировались) и опасная зона (удаление аккаунта). Личные
// данные — в "Профиль" (ProfileView.tsx), предметы и тариф — в "Мои предметы" (SubjectsView.tsx).
import { useEffect, useRef, useState } from "react";
import { useAuth, type Gender, type Goal, type Grade } from "../lib/auth";
import { ChoiceRow, GOAL_OPTS, GRADE_OPTS, TIME_OPTS } from "./OnboardingFlow";
import { RUSSIAN_REGIONS, CITIES_BY_REGION } from "../data/geo";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

const CURRENT_YEAR = new Date().getFullYear();
const EXAM_YEAR_OPTS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2].map((y) => ({ v: y, l: String(y) }));
const GENDER_OPTS: { v: Gender; l: string }[] = [
  { v: "m", l: "Мужской" },
  { v: "f", l: "Женский" },
];

export default function SettingsView({
  onNav,
  highlightPrep,
  highlightProfile,
}: {
  onNav: (v: View) => void;
  highlightPrep?: boolean;
  highlightProfile?: boolean;
}) {
  const { profile, updateProfile, changePassword, deleteAccount, isGuestMode } = useAuth();
  const { push } = useToast();

  const [grade, setGrade] = useState<Grade | null>(profile?.grade ?? null);
  const [examYear, setExamYear] = useState<number | null>(profile?.examYear ?? null);
  const [goal, setGoal] = useState<Goal | null>(profile?.goal ?? null);
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(profile?.dailyMinutes ?? null);
  const [saving, setSaving] = useState(false);

  // Подсветка блока "Параметры подготовки" — пришли сюда по кнопке "Заполнить" из напоминалки на
  // главной (см. Dashboard.tsx → OnboardingNudge, highlightPrep в навигации к этому виду). Гаснет
  // после первого сохранения (см. save() ниже) — не привязана к тому, заполнены ли поля, поэтому
  // подсказывает "заполни и сохрани", а не "все клетки должны быть непустыми".
  const [showHighlight, setShowHighlight] = useState(!!highlightPrep);
  const prepRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlightPrep) prepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightPrep]);

  const [region, setRegion] = useState<string | null>(profile?.region ?? null);
  const [city, setCity] = useState<string | null>(profile?.city ?? null);
  const [school, setSchool] = useState<string | null>(profile?.school ?? null);
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : "");
  const [gender, setGender] = useState<Gender | null>(profile?.gender ?? null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Подсветка блока "О себе" — пришли сюда по кнопке "Заполнить" из напоминалки для уже
  // зарегистрированных пользователей (см. Dashboard.tsx → ProfileCompletionNudge,
  // highlightProfile в навигации к этому виду) — тот же приём, что у highlightPrep выше.
  const [showProfileHighlight, setShowProfileHighlight] = useState(!!highlightProfile);
  const profileRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlightProfile) profileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightProfile]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!profile) return null;

  const dirty =
    grade !== (profile.grade ?? null) ||
    examYear !== (profile.examYear ?? null) ||
    goal !== (profile.goal ?? null) ||
    dailyMinutes !== (profile.dailyMinutes ?? null);

  const save = async () => {
    setSaving(true);
    // онбординг обычно проходят через OnboardingFlow.tsx (4 шага сразу), но не все ученики его
    // доходят до конца (см. напоминалку на главной — Dashboard.tsx, OnboardingNudge) — если он
    // донабирает те же 4 поля здесь, это тоже полноценное прохождение анкеты: ставим onboardedAt
    // сами, тем же способом, что finalizeAndGo в OnboardingFlow.tsx. Не перезаписываем, если уже
    // стоит — исходная дата прохождения не должна съезжать при обычной правке цели/класса позже.
    const quizComplete = !!(grade && examYear && goal && dailyMinutes);
    await updateProfile({
      grade: grade ?? undefined,
      examYear: examYear ?? undefined,
      goal: goal ?? undefined,
      dailyMinutes: dailyMinutes ?? undefined,
      ...(quizComplete && !profile.onboardedAt ? { onboardedAt: Date.now() } : {}),
    });
    setSaving(false);
    setShowHighlight(false);
    push("Изменения сохранены", "ok");
  };

  const ageNum = age.trim() ? Number(age) : null;
  const dirtyProfile =
    region !== (profile.region ?? null) ||
    city !== (profile.city ?? null) ||
    school !== (profile.school ?? null) ||
    ageNum !== (profile.age ?? null) ||
    gender !== (profile.gender ?? null);

  const saveProfile = async () => {
    setSavingProfile(true);
    await updateProfile({
      region: region ?? undefined,
      city: city ?? undefined,
      school: school ?? undefined,
      age: ageNum ?? undefined,
      gender: gender ?? undefined,
    });
    setSavingProfile(false);
    setShowProfileHighlight(false);
    push("Изменения сохранены", "ok");
  };

  const savePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) return setPwError("Заполни оба поля пароля.");
    if (newPassword.length < 6) return setPwError("Новый пароль должен быть не короче 6 символов.");
    if (newPassword !== confirmPassword) return setPwError("Пароли не совпадают.");
    setPwSaving(true);
    setPwError(null);
    const res = await changePassword(currentPassword, newPassword);
    setPwSaving(false);
    if (res.error) return setPwError(res.error);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    push("Пароль изменён", "ok");
  };

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

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">настройки</p>
      <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Параметры подготовки</h1>

      <section
        ref={prepRef}
        className={`sheet mt-6 space-y-4 p-5 sm:p-6 transition-shadow ${showHighlight ? "ring-2 ring-amber ring-offset-2 ring-offset-paper" : ""}`}
      >
        {showHighlight && (
          <p className="anim-rise flex items-center gap-2 border-l-4 border-amber bg-amber/10 px-3 py-2 text-[12.5px] font-bold text-ink">
            <Icon name="target" size={14} className="shrink-0 text-amber" /> Заполни это и сохрани — тогда «План» и «Пробник» будут знать твой предмет и темп.
          </p>
        )}
        <ChoiceRow label="класс" options={GRADE_OPTS} value={grade} onChange={setGrade} />
        <ChoiceRow label="год сдачи ЕГЭ" options={EXAM_YEAR_OPTS} value={examYear} onChange={setExamYear} />
        <ChoiceRow label="цель" options={GOAL_OPTS} value={goal} onChange={setGoal} />
        <ChoiceRow label="время в день" options={TIME_OPTS} value={dailyMinutes} onChange={setDailyMinutes} />
        <button onClick={save} disabled={!dirty || saving} className="btn btn-blue px-5 py-2.5 text-sm">
          {saving ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      </section>

      <section
        ref={profileRef}
        className={`sheet mt-4 space-y-4 p-5 sm:p-6 transition-shadow ${showProfileHighlight ? "ring-2 ring-amber ring-offset-2 ring-offset-paper" : ""}`}
      >
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">о себе</p>
        {showProfileHighlight && (
          <p className="anim-rise flex items-center gap-2 border-l-4 border-amber bg-amber/10 px-3 py-2 text-[12.5px] font-bold text-ink">
            <Icon name="target" size={14} className="shrink-0 text-amber" /> Заполни это и сохрани — эти данные помогают нам понимать нашу аудиторию.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Регион</span>
            <select
              value={region ?? ""}
              onChange={(e) => { setRegion(e.target.value || null); setCity(null); }}
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
            >
              <option value="">Не указан</option>
              {RUSSIAN_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Город</span>
            <input
              list="settings-city-options"
              value={city ?? ""}
              onChange={(e) => setCity(e.target.value || null)}
              disabled={!region}
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm disabled:opacity-50"
              placeholder={region ? "Выбери из списка или впиши свой" : "Сначала выбери регион"}
            />
            <datalist id="settings-city-options">
              {(region ? (CITIES_BY_REGION[region] ?? []) : []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">
              Школа <span className="font-normal normal-case text-ink2">(необязательно)</span>
            </span>
            <input
              value={school ?? ""}
              onChange={(e) => setSchool(e.target.value || null)}
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
              placeholder="Номер и/или название школы"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Возраст</span>
            <input
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="input-blank mt-1.5 w-full rounded-sm px-3.5 py-2.5 text-sm"
              placeholder="17"
            />
          </label>
        </div>
        <div>
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">Пол</span>
          <div className="mt-1.5 flex gap-2">
            {GENDER_OPTS.map((o) => (
              <button
                key={o.v}
                onClick={() => setGender(o.v)}
                className={`flex-1 rounded-sm border-2 px-3.5 py-2.5 text-[13px] font-bold transition sm:flex-none sm:px-6 ${
                  gender === o.v ? "border-blue bg-blue text-white" : "border-ink/20 text-ink2 hover:border-ink/50 hover:text-ink"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <button onClick={saveProfile} disabled={!dirtyProfile || savingProfile} className="btn btn-blue px-5 py-2.5 text-sm">
          {savingProfile ? "Сохраняем…" : "Сохранить изменения"}
        </button>
      </section>

      {!isGuestMode && (
        <section className="sheet mt-4 space-y-3 p-5 sm:p-6">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink2">сменить пароль</p>
          <div className="relative">
            <input
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
              placeholder="Текущий пароль"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-ink2 hover:text-ink"
              aria-label={showPassword ? "Скрыть пароли" : "Показать пароли"}
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
          <div className="relative">
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
              placeholder="Новый пароль — минимум 6 символов"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-ink2 hover:text-ink"
              aria-label={showPassword ? "Скрыть пароли" : "Показать пароли"}
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
          <div className="relative">
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              onKeyDown={(e) => e.key === "Enter" && savePassword()}
              className="input-blank w-full rounded-sm px-3.5 py-2.5 pr-10 text-sm"
              placeholder="Повтори новый пароль"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-ink2 hover:text-ink"
              aria-label={showPassword ? "Скрыть пароли" : "Показать пароли"}
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} size={16} />
            </button>
          </div>
          {pwError && (
            <p className="anim-rise flex items-center gap-2 text-[13px] font-bold text-red">
              <Icon name="alert" size={15} /> {pwError}
            </p>
          )}
          <button onClick={savePassword} disabled={pwSaving} className="btn btn-blue px-5 py-2.5 text-sm">
            {pwSaving ? "Сохраняем…" : "Сменить пароль"}
          </button>
        </section>
      )}

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
    </div>
  );
}
