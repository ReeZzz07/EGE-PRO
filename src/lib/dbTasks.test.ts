// getAvailableSubjects() — предметы без заданий в банке (сейчас: «Информатика») скрыты из
// онбординга/дашборда/банка заданий (см. App.tsx/Dashboard.tsx/Landing.tsx/OnboardingFlow.tsx/
// TaskBank.tsx). Модуль держит состояние на уровне модуля (subjectAggs/subjectAggsLoaded/TASKS),
// поэтому каждый тест грузит СВОЙ экземпляр через vi.resetModules() + динамический import —
// иначе прогоны тестов заражали бы состояние друг друга (агрегаты грузятся один раз за модуль).
import { beforeEach, describe, expect, it, vi } from "vitest";

const ALL_12_SUBJECTS = ["math", "rus", "inf", "fiz", "soc", "bio", "eng", "geo", "chem", "hist", "lit", "math_base"];

beforeEach(() => {
  vi.resetModules();
});

/** Билдер PostgREST-цепочки .from("tasks").select(...).eq("published",true).eq("subject", s) —
 *  запоминает последний eq("subject", ...) и резолвит им сконфигурированные строки. */
function makeSupabaseMock(rowsBySubject: Record<string, { points: number; bucket: string }[]>) {
  function builder(subject?: string): Record<string, unknown> {
    return {
      select: () => builder(subject),
      eq: (col: string, val: unknown) => builder(col === "subject" ? String(val) : subject),
      then: (resolve: (v: { data: { points: number; bucket: string }[]; error: null }) => void) =>
        resolve({ data: subject ? (rowsBySubject[subject] ?? []) : [], error: null }),
    };
  }
  return { from: vi.fn(() => builder()) };
}

async function loadDbTasks(opts: { configured: boolean; rowsBySubject?: Record<string, { points: number; bucket: string }[]> }) {
  vi.doMock("./supabase", () => ({
    isSupabaseConfigured: opts.configured,
    supabase: opts.configured ? makeSupabaseMock(opts.rowsBySubject ?? {}) : null,
  }));
  return import("./dbTasks");
}

describe("getAvailableSubjects", () => {
  it("гостевой режим (бэкенд не подключён) — все предметы, фильтровать нечем", async () => {
    const { getAvailableSubjects } = await loadDbTasks({ configured: false });
    expect(getAvailableSubjects().sort()).toEqual(ALL_12_SUBJECTS.sort());
  });

  it("бэкенд подключён, но агрегаты ещё не грузились — все предметы (не мигаем пустым списком)", async () => {
    const { getAvailableSubjects } = await loadDbTasks({ configured: true, rowsBySubject: {} });
    expect(getAvailableSubjects().sort()).toEqual(ALL_12_SUBJECTS.sort());
  });

  it("после загрузки агрегатов — предмет с нулём заданий (inf) скрыт, остальные остаются", async () => {
    const rowsBySubject: Record<string, { points: number; bucket: string }[]> = {};
    for (const s of ALL_12_SUBJECTS) rowsBySubject[s] = s === "inf" ? [] : [{ points: 1, bucket: "auto" }];

    const { getAvailableSubjects, loadSubjectAggregates } = await loadDbTasks({ configured: true, rowsBySubject });
    await loadSubjectAggregates();

    const available = getAvailableSubjects();
    expect(available).not.toContain("inf");
    expect(available.sort()).toEqual(ALL_12_SUBJECTS.filter((s) => s !== "inf").sort());
  });

  it("если заданий нет вообще ни по одному предмету — список пуст, а не всё подряд", async () => {
    const rowsBySubject: Record<string, { points: number; bucket: string }[]> = {};
    for (const s of ALL_12_SUBJECTS) rowsBySubject[s] = [];

    const { getAvailableSubjects, loadSubjectAggregates } = await loadDbTasks({ configured: true, rowsBySubject });
    await loadSubjectAggregates();

    expect(getAvailableSubjects()).toEqual([]);
  });
});

// Часть банка (LLM-решатель, см. scripts/import/solve-tasks.mjs) хранит разбор, обрезанный
// посередине шага — модель упёрлась в лимит токенов при генерации (см. историю правок этого
// файла). sanitizeExplanation — защита на чтение: отрезает такой шаг и всё, что после него.
describe("sanitizeExplanation", () => {
  it("полностью нормальный разбор — возвращает как есть", async () => {
    const { sanitizeExplanation } = await import("./dbTasks");
    const steps = ["1) Первый шаг решения.", "2) Второй шаг решения.", "Ответ: 42."];
    expect(sanitizeExplanation(steps)).toEqual(steps);
  });

  it("обрыв на полуслове без знака конца предложения — обрубает начиная с этого шага", async () => {
    const { sanitizeExplanation } = await import("./dbTasks");
    const steps = ["1) По графику Тогда", "2) следовательно,", "3) Подставим точку", "4)"];
    expect(sanitizeExplanation(steps)).toEqual([]);
  });

  it("обрыв в СЕРЕДИНЕ разбора — сохраняет только полные шаги до него", async () => {
    const { sanitizeExplanation } = await import("./dbTasks");
    const steps = [
      "1) Производственный кооператив «Максим» – это пример предприятия как частного субъекта экономики.",
      "2) ГУП «Мосэлектротранс» – государственные унитарные предприятия.",
      "3) Министерство экономического развития РФ – государственный орган.",
      "4) Общество с ограниченной",
    ];
    expect(sanitizeExplanation(steps)).toEqual(steps.slice(0, 3));
  });

  it("пустой шаг-заглушка (только номер, без текста) — тоже считается обрывом", async () => {
    const { sanitizeExplanation } = await import("./dbTasks");
    expect(sanitizeExplanation(["1) Шаг с текстом.", "2)"])).toEqual(["1) Шаг с текстом."]);
  });

  it("шаг, заканчивающийся закрывающей кавычкой/скобкой — не считается обрывом", async () => {
    const { sanitizeExplanation } = await import("./dbTasks");
    expect(sanitizeExplanation(['Смотри правило («важно»)'])).toEqual(['Смотри правило («важно»)']);
  });
});

// Жалоба 27.09.2026: биология «Признаки живого», эталон «размножение / воспроизведение / репродукция /
// самовоспроизведение» — ответ «размножение» отмечался неверным, потому что вся строка шла ОДНИМ вариантом.
describe("answerVariants — несколько допустимых ответов в одной строке", () => {
  it("« / » разделяет варианты; полная строка остаётся первой (её показывают как эталон)", async () => {
    const { answerVariants } = await import("./dbTasks");
    const v = answerVariants("размножение / воспроизведение / репродукция / самовоспроизведение");
    expect(v[0]).toBe("размножение / воспроизведение / репродукция / самовоспроизведение");
    expect(v.slice(1)).toEqual(["размножение", "воспроизведение", "репродукция", "самовоспроизведение"]);
  });

  it("цифровые наборы («346 / 78») и «//» — тоже альтернативы", async () => {
    const { answerVariants } = await import("./dbTasks");
    expect(answerVariants("346 / 78")).toEqual(["346 / 78", "346", "78"]);
    expect(answerVariants("наполнить // заполнить")).toEqual(["наполнить // заполнить", "наполнить", "заполнить"]);
  });

  it("слэш между двумя словами без пробелов — альтернатива; единицы измерения и дроби — нет", async () => {
    const { answerVariants } = await import("./dbTasks");
    expect(answerVariants("КОНСТАНТИНОПОЛЬ/ЦАРЬГРАД")).toEqual(["КОНСТАНТИНОПОЛЬ/ЦАРЬГРАД", "КОНСТАНТИНОПОЛЬ", "ЦАРЬГРАД"]);
    for (const a of ["225 кВ/м", "2,2 км/ч", "3,1 м/с", "250 кг·м/с", "3/4", "5"]) expect(answerVariants(a)).toEqual([a]);
  });

  it("служебные пометки банка после ответа (ЕГЭ-2026, ссылка на видео, автор, «Открытый вариант…») в варианты не попадают", async () => {
    const { answerVariants } = await import("./dbTasks");
    expect(answerVariants("451326 / 623154\n\nЕГЭ-2026. Основная волна.")).toEqual(["451326 / 623154", "451326", "623154"]);
    expect(answerVariants("45\n\nЗадание было на ЕГЭ-2025")).toEqual(["45"]);
    expect(answerVariants("34152\n\nhttps://kinescope.io/embed/3L4SdmkoNajct13ErW7N1V")).toEqual(["34152"]);
    expect(answerVariants("84\n\nАвтор: реальное задание (собрано И. Ермолаевым), ред. ChemFamily")).toEqual(["84"]);
    expect(answerVariants("15\r\n\r\nОткрытый вариант ФИПИ 2026")).toEqual(["15"]);
  });

  it("«а.⏎⏎Ответ: 112222» — настоящий ответ во второй строке, обломок «а.» ответом не считается", async () => {
    const { answerVariants } = await import("./dbTasks");
    expect(answerVariants("а.\n\nОтвет: 112222")).toEqual(["112222"]);
    expect(answerVariants("Б\n\nЕГЭ-2025, основная волна")).toEqual(["Б"]); // короткая строка — сам ответ, а не обломок
  });

  it("пустая строка — нет вариантов; целиком «мусорная» (обрывок пояснения) — остаётся как есть, без выдуманных вариантов", async () => {
    const { answerVariants } = await import("./dbTasks");
    expect(answerVariants("")).toEqual([]);
    const junk = "ы:\n3) клубеньковые бактерии (симбионты бобовых растений, гетеротрофы); 5) венерина мухоловка (хищное растение, фотоавтотроф, так как насекомых ловит как дополнительный источник азота)";
    expect(answerVariants(junk)).toEqual([junk]);
  });

  it("вместе с checkAnswer: любой из вариантов засчитывается, посторонний — нет", async () => {
    const { answerVariants } = await import("./dbTasks");
    const { checkAnswer } = await import("./utils");
    const acc = answerVariants("размножение / воспроизведение / репродукция");
    expect(checkAnswer("размножение", acc)).toBe(true);
    expect(checkAnswer("Репродукция", acc)).toBe(true);
    expect(checkAnswer("рост", acc)).toBe(false);
    // ответ с приклеенной пометкой банка раньше был недостижим — верный «45» отмечался неверным
    expect(checkAnswer("45", answerVariants("45\n\nЗадание было на ЕГЭ-2025"))).toBe(true);
  });
});
