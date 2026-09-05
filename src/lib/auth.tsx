import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";
import { addProfileSubject, loadProfileSubjects, removeProfileSubject } from "./profileSubjects";
import type { Subject } from "../data/tasks";

export type Grade = "10" | "11" | "grad";
export type Goal = "threshold" | "70plus" | "80plus" | "olympiad";

export interface Profile {
  id: string;
  name: string;
  email: string;
  grade?: Grade;
  examYear?: number;
  goal?: Goal;
  dailyMinutes?: number;
  /** предмет, выбранный на онбординге — остаётся "предметом по умолчанию" везде, где явно не
   *  выбран другой (см. subjects ниже) */
  primarySubject?: Subject;
  /** все активные предметы ученика (public.profile_subjects), включая primarySubject — сколько их
   *  может быть, ограничивает тариф (subjectsCount). Пусто, пока не загрузилось. */
  subjects: Subject[];
  /** timestamp завершения онбординга (квиз + «как это работает») */
  onboardedAt?: number;
  /** доступ к админке управления контентом лендинга (раздел 2.4 ТЗ, узкий срез) */
  isAdmin?: boolean;
  /** id тарифа из public.tariffs; по умолчанию "free". Администраторы тариф игнорируют — им
   *  всегда доступно всё, независимо от того, что здесь записано (см. isAdmin). */
  tariffId?: string;
  /** "preset:<id>" (см. lib/avatar.ts AVATAR_PRESETS) или путь к загруженному файлу
   *  ("avatars/<id>.<ext>", см. server.js POST /profile/avatar). Пусто — используем инициал имени. */
  avatarUrl?: string;
}

interface AuthResult {
  error?: string;
}

interface AuthCtx {
  profile: Profile | null;
  loading: boolean;
  /** true, если Supabase не подключён — работаем в локальном гостевом режиме (см. SETUP.md) */
  isGuestMode: boolean;
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** необратимо: в режиме с бэкендом требует пароль (см. server.js DELETE /auth/account) и
   *  каскадом уносит вообще все данные пользователя — профиль, предметы, попытки, диагностику,
   *  план, чат с ИИ. В гостевом режиме пароля нет — просто очищает локальный профиль. */
  deleteAccount: (password: string) => Promise<AuthResult>;
  /** недоступно в гостевом режиме — там пароля никогда не было (см. signIn). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  /** возвращает свежую сессию под капотом (см. supabase.ts authShim.changeEmail) — profile.email
   *  обновится сам через onAuthStateChange, вызывать updateProfile для этого не нужно. */
  changeEmail: (password: string, newEmail: string) => Promise<AuthResult>;
  /** null — сбросить на дефолтный аватар (инициал имени). Отдельно от updateProfile: там
   *  undefined-поля патча означают "не трогать", а здесь null — осознанный сброс, это разные вещи. */
  setAvatar: (value: string | null) => Promise<AuthResult>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  /** перечитать profile.subjects из БД — вызывать после addProfileSubject/removeProfileSubject
   *  (см. lib/profileSubjects.ts), эти функции сами по себе локальный profile не трогают. */
  refreshSubjects: () => Promise<void>;
}

const GUEST_KEY = "ege-pro.guest-profile.v1";
const AuthCtx = createContext<AuthCtx | null>(null);

function loadGuestProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function saveGuestProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(GUEST_KEY, JSON.stringify(p));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // ── гостевой режим: Supabase не подключён ──
  useEffect(() => {
    if (isSupabaseConfigured) return;
    setProfile(loadGuestProfile());
    setLoading(false);
  }, []);

  // ── режим Supabase ──
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;

    async function loadProfile(userId: string, fallbackEmail: string, fallbackName: string) {
      const [{ data }, subjects] = await Promise.all([
        supabase!.from("profiles").select("*").eq("id", userId).maybeSingle(),
        loadProfileSubjects(userId),
      ]);
      if (cancelled) return;
      if (data) {
        setProfile({
          id: data.id,
          name: data.full_name ?? fallbackName,
          email: fallbackEmail,
          grade: data.grade ?? undefined,
          examYear: data.exam_year ?? undefined,
          goal: data.goal ?? undefined,
          dailyMinutes: data.daily_minutes ?? undefined,
          primarySubject: data.primary_subject ?? undefined,
          subjects,
          onboardedAt: data.onboarded_at ? new Date(data.onboarded_at).getTime() : undefined,
          isAdmin: data.is_admin ?? false,
          tariffId: data.tariff_id ?? "free",
          avatarUrl: data.avatar_url ?? undefined,
        });
      } else {
        setProfile({ id: userId, name: fallbackName, email: fallbackEmail, subjects });
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (u) loadProfile(u.id, u.email ?? "", (u.user_metadata?.full_name as string) ?? "");
      else setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      if (u) loadProfile(u.id, u.email ?? "", (u.user_metadata?.full_name as string) ?? "");
      else setProfile(null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, name: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured || !supabase) {
      const p: Profile = { id: "guest-" + Date.now(), name, email, subjects: [] };
      saveGuestProfile(p);
      setProfile(p);
      return {};
    }
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) return { error: error.message };
    if (data.user) {
      // профиль создастся триггером handle_new_user; подстрахуемся локальным значением сразу
      setProfile({ id: data.user.id, name, email, subjects: [] });
    }
    return {};
  };

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured || !supabase) {
      const existing = loadGuestProfile();
      if (existing && existing.email === email) {
        setProfile(existing);
        return {};
      }
      return { error: "В гостевом режиме нет реальной проверки пароля — зарегистрируйся с этим email." };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) await supabase.auth.signOut();
    saveGuestProfile(null);
    setProfile(null);
  };

  const deleteAccount = async (password: string): Promise<AuthResult> => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.deleteAccount(password);
      if (error) return { error: error.message };
    }
    saveGuestProfile(null);
    setProfile(null);
    return {};
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured || !supabase) return { error: "В гостевом режиме пароля нет — менять нечего." };
    const { error } = await supabase.auth.changePassword(currentPassword, newPassword);
    return error ? { error: error.message } : {};
  };

  const changeEmail = async (password: string, newEmail: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured || !supabase) return { error: "В гостевом режиме email — просто локальная метка, менять негде." };
    const { error } = await supabase.auth.changeEmail(password, newEmail);
    return error ? { error: error.message } : {};
  };

  const setAvatar = async (value: string | null): Promise<AuthResult> => {
    if (isSupabaseConfigured && supabase && profile) {
      const { error } = await supabase.from("profiles").update({ avatar_url: value }).eq("id", profile.id);
      if (error) return { error: error.message };
    }
    setProfile((prev) => {
      const next = prev ? { ...prev, avatarUrl: value ?? undefined } : prev;
      if (next && !isSupabaseConfigured) saveGuestProfile(next);
      return next;
    });
    return {};
  };

  const updateProfile = async (patch: Partial<Profile>) => {
    const previousPrimarySubject = profile?.primarySubject;
    setProfile((prev) => {
      const next = prev ? { ...prev, ...patch } : null;
      if (next && !isSupabaseConfigured) saveGuestProfile(next);
      return next;
    });
    if (isSupabaseConfigured && supabase && profile) {
      let primarySubjectToWrite = patch.primarySubject;

      // онбординг задаёт primarySubject один раз — это и есть "добавить первый предмет"
      // (см. lib/profileSubjects.ts); дальше пользователь добавляет остальные сам на дашборде.
      // Русский и математика базового уровня подключаются автоматически при регистрации (триггер
      // handle_new_user, см. supabase/migrations/0015) — если на онбординге выбрана профильная
      // математика, это не "ещё один предмет", а замена базовой: сначала освобождаем её место,
      // иначе упрёмся в лимит предметов тарифа, пытаясь добавить профильную поверх базовой.
      if (patch.primarySubject && !profile.subjects.includes(patch.primarySubject)) {
        const swappingMathLevel = patch.primarySubject === "math" && profile.subjects.includes("math_base");
        if (swappingMathLevel) await removeProfileSubject(profile.id, "math_base");
        const res = await addProfileSubject(profile.id, patch.primarySubject);
        if (res.error) {
          // не удалось подключить выбранный предмет (лимит тарифа — например, на лендинге выбран
          // элективный предмет для онбординга, а рус+база уже заняли оба места на бесплатном
          // тарифе) — не пишем primary_subject на несуществующий предмет и откатываем то, что уже
          // оптимистично применили в setProfile выше
          primarySubjectToWrite = previousPrimarySubject;
          setProfile((prev) => (prev ? { ...prev, primarySubject: previousPrimarySubject } : prev));
        } else {
          setProfile((prev) => {
            if (!prev) return prev;
            const withoutOldMath = swappingMathLevel ? prev.subjects.filter((s) => s !== "math_base") : prev.subjects;
            return { ...prev, subjects: [...withoutOldMath, patch.primarySubject!] };
          });
        }
      }

      await supabase
        .from("profiles")
        .update({
          full_name: patch.name,
          grade: patch.grade,
          exam_year: patch.examYear,
          goal: patch.goal,
          daily_minutes: patch.dailyMinutes,
          primary_subject: primarySubjectToWrite,
          onboarded_at: patch.onboardedAt ? new Date(patch.onboardedAt).toISOString() : undefined,
          tariff_id: patch.tariffId,
        })
        .eq("id", profile.id);
    }
  };

  const refreshSubjects = async () => {
    if (!isSupabaseConfigured || !supabase || !profile) return;
    const subjects = await loadProfileSubjects(profile.id);
    setProfile((prev) => (prev ? { ...prev, subjects } : prev));
  };

  return (
    <AuthCtx.Provider
      value={{ profile, loading, isGuestMode: !isSupabaseConfigured, signUp, signIn, signOut, deleteAccount, changePassword, changeEmail, setAvatar, updateProfile, refreshSubjects }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
