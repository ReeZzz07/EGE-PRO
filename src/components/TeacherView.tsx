import { useEffect, useState } from "react";
import {
  createTeacherClass,
  deleteTeacherClass,
  loadClassMembers,
  loadTeacherClasses,
  removeClassMember,
  type TeacherClass,
  type TeacherMember,
} from "../lib/teacher";
import { Icon, useToast } from "./ui";
import type { View } from "./Header";

export default function TeacherView({ onNav }: { onNav: (v: View) => void }) {
  const { push } = useToast();
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<TeacherMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setClasses(await loadTeacherClasses());
    } catch (e) {
      push(e instanceof Error ? e.message : "Не удалось загрузить классы", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    loadClassMembers(selected)
      .then(setMembers)
      .catch((e) => push(e instanceof Error ? e.message : "Не удалось загрузить учеников", "err"))
      .finally(() => setMembersLoading(false));
  }, [selected, push]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await createTeacherClass(name.trim());
      setName("");
      setClasses((prev) => [c, ...prev]);
      setSelected(c.id);
      push(`Класс «${c.name}» создан. Код: ${c.inviteCode}`, "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Не удалось создать класс", "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Удалить класс и всех учеников из него?")) return;
    try {
      await deleteTeacherClass(id);
      setClasses((prev) => prev.filter((c) => c.id !== id));
      if (selected === id) setSelected(null);
      push("Класс удалён", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Не удалось удалить", "err");
    }
  };

  const kick = async (studentId: string) => {
    if (!selected) return;
    try {
      await removeClassMember(selected, studentId);
      setMembers((prev) => prev.filter((m) => m.id !== studentId));
      setClasses((prev) => prev.map((c) => (c.id === selected ? { ...c, members: Math.max(0, c.members - 1) } : c)));
    } catch (e) {
      push(e instanceof Error ? e.message : "Не удалось исключить", "err");
    }
  };

  const active = classes.find((c) => c.id === selected);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-20">
      <div className="mt-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-blue">учитель</p>
          <h1 className="font-display mt-1 text-2xl font-black sm:text-3xl">Мои классы</h1>
          <p className="mt-2 max-w-xl text-[13.5px] text-ink2">
            Создай класс, отдай ученикам код приглашения — они введут его в настройках. Здесь видно попытки, точность и итог диагностики.
          </p>
        </div>
        <button onClick={() => onNav({ name: "home" })} className="btn btn-ghost px-4 py-2.5 text-[13px]">
          <Icon name="arrowL" size={15} /> На главную
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название класса, например «11А · русский»"
          className="input-blank min-w-[220px] flex-1 rounded-sm px-3 py-2.5 text-[14px]"
        />
        <button onClick={create} disabled={busy || !name.trim()} className="btn btn-blue px-4 py-2.5 text-[13px] disabled:opacity-50">
          <Icon name="spark" size={15} /> Создать
        </button>
      </div>

      {loading ? (
        <p className="mt-10 text-center font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Загрузка…</p>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-2">
            {classes.length === 0 && <li className="text-[13.5px] text-ink2">Пока нет классов — создай первый.</li>}
            {classes.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c.id)}
                  className={`w-full border-2 px-3 py-3 text-left transition ${selected === c.id ? "border-blue bg-blue/8" : "border-ink/15 hover:border-ink/40"}`}
                >
                  <span className="font-display block text-[15px] font-bold">{c.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-ink2">
                    <span>код {c.inviteCode}</span>
                    <span>·</span>
                    <span>{c.members} уч.</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="sheet min-h-[240px] p-5">
            {!active ? (
              <p className="text-[13.5px] text-ink2">Выбери класс слева, чтобы увидеть учеников.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-black">{active.name}</h2>
                    <p className="mt-1 font-mono text-[12px] text-ink2">
                      Код приглашения: <strong className="text-ink">{active.inviteCode}</strong>
                      <button
                        type="button"
                        className="ml-2 link-slide font-bold text-blue"
                        onClick={() => {
                          navigator.clipboard?.writeText(active.inviteCode).then(
                            () => push("Код скопирован", "ok"),
                            () => push("Не удалось скопировать", "err")
                          );
                        }}
                      >
                        копировать
                      </button>
                    </p>
                  </div>
                  <button onClick={() => remove(active.id)} className="btn btn-ghost px-3 py-2 text-[12px] text-red">
                    Удалить класс
                  </button>
                </div>

                {membersLoading ? (
                  <p className="mt-8 text-center font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">Ученики…</p>
                ) : members.length === 0 ? (
                  <p className="mt-6 text-[13.5px] text-ink2">Пока никто не вступил. Дай ученикам код {active.inviteCode}.</p>
                ) : (
                  <ul className="mt-5 divide-y divide-ink/10">
                    {members.map((m) => {
                      const acc = m.attempts ? Math.round((m.correct / m.attempts) * 100) : null;
                      return (
                        <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                          <div>
                            <p className="font-bold">{m.name}</p>
                            <p className="font-mono text-[11.5px] text-ink2">{m.email}</p>
                            <p className="mt-1 text-[13px] text-ink2">
                              {m.attempts} попыток{acc != null ? ` · ${acc}% верно` : ""}
                              {m.reviewTopics ? ` · ${m.reviewTopics} тем на повторении` : ""}
                            </p>
                            {m.diagnostic && (
                              <p className="mt-0.5 text-[12.5px] text-ink2">
                                Диагностика ({m.diagnostic.subjectName}): {m.diagnostic.level ?? "—"}
                                {m.diagnostic.scoreMin != null && m.diagnostic.scoreMax != null
                                  ? ` · ~${m.diagnostic.scoreMin}–${m.diagnostic.scoreMax}`
                                  : ""}
                              </p>
                            )}
                          </div>
                          <button onClick={() => kick(m.id)} className="btn btn-ghost px-3 py-1.5 text-[12px]">
                            Исключить
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
