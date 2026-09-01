export type Subject = "math" | "rus" | "inf" | "fiz" | "soc" | "bio" | "eng" | "geo" | "chem" | "hist" | "lit" | "math_base";

export interface SubjectMeta {
  id: Subject;
  name: string;
  short: string;
  color: string; // tailwind-класс акцента
  bg: string;
  desc: string;
}

export const SUBJECTS: Record<Subject, SubjectMeta> = {
  math: { id: "math", name: "Математика (профиль)", short: "МАТ", color: "text-blue", bg: "bg-blue", desc: "Практические задачи, уравнения, вероятность, производная, стереометрия" },
  rus: { id: "rus", name: "Русский язык", short: "РУС", color: "text-red", bg: "bg-red", desc: "Орфоэпия, паронимы, орфография: НЕ, Н/НН, приставки" },
  inf: { id: "inf", name: "Информатика", short: "ИНФ", color: "text-green", bg: "bg-green", desc: "Системы счисления, объём информации, логика, алгоритмы" },
  fiz: { id: "fiz", name: "Физика", short: "ФИЗ", color: "text-amber", bg: "bg-amber", desc: "Кинематика, динамика, законы сохранения, электричество" },
  soc: { id: "soc", name: "Обществознание", short: "ОБЩ", color: "text-teal", bg: "bg-teal", desc: "Экономика, общество, право — задания с множественным выбором" },
  bio: { id: "bio", name: "Биология", short: "БИО", color: "text-violet", bg: "bg-violet", desc: "Цитология, генетика, физиология человека, эволюция и экология" },
  eng: { id: "eng", name: "Английский язык", short: "АНГ", color: "text-rose", bg: "bg-rose", desc: "Грамматика, лексика, чтение, аудирование, письмо" },
  geo: { id: "geo", name: "География", short: "ГЕО", color: "text-cyan", bg: "bg-cyan", desc: "Природа, население, хозяйство России и мира, картография" },
  chem: { id: "chem", name: "Химия", short: "ХИМ", color: "text-lime", bg: "bg-lime", desc: "Строение вещества, реакции, органика и неорганика, расчётные задачи" },
  hist: { id: "hist", name: "История", short: "ИСТ", color: "text-orange", bg: "bg-orange", desc: "События, даты, персоналии, работа с источниками и картами" },
  lit: { id: "lit", name: "Литература", short: "ЛИТ", color: "text-indigo", bg: "bg-indigo", desc: "Анализ текста, теория литературы, развёрнутые сочинения" },
  math_base: { id: "math_base", name: "Математика (базовый уровень)", short: "МАТБ", color: "text-brown", bg: "bg-brown", desc: "Практические задачи для аттестата — без профильных тем" },
};

export interface EssayCriterion {
  code: string; // К1, К2…
  name: string;
  max: number; // максимальный балл по критерию
}

export interface EgeTask {
  id: string;
  fipiId: string; // номер в Открытом банке ФИПИ
  subject: Subject;
  egeNumber: number; // номер задания в структуре ЕГЭ
  topic: string;
  /** Более широкий раздел, к которому относится тема (есть только у импортированных заданий) */
  section?: string;
  difficulty: 1 | 2 | 3;
  points: number; // первичные баллы
  statement: string[];
  options?: string[];
  /** URL картинок к заданию (графики/диаграммы/рисунки) — для заданий, импортированных из банка ФИПИ */
  images?: string[];
  answers: string[]; // нормализованные допустимые ответы (для answerType "short")
  answerNote: string;
  explanation: string[];
  hints: [string, string, string];
  /** "short" (по умолчанию) — краткий ответ проверяется автоматически;
   *  "essay" — развёрнутый ответ/сочинение, проверяется ИИ по критериям, единого "правильного" текста нет. */
  answerType?: "short" | "essay";
  /** Критерии оценивания для answerType === "essay" */
  criteria?: EssayCriterion[];
  /** Минимальные и рекомендуемые требования к объёму (только для essay) */
  minWords?: number;
}

export const DIFF_LABEL: Record<number, string> = { 1: "базовая", 2: "повышенная", 3: "высокая" };

/** Пусто по умолчанию — весь банк живёт в БД (public.tasks) и подгружается лениво по предмету,
 *  см. lib/dbTasks.ts. Раньше здесь лежал небольшой набор демо-заданий для тестов, но с реальным
 *  импортированным банком (~58 тыс. заданий) он был удалён как избыточный. */
export const TASKS: EgeTask[] = [];

export const totalPoints = () => TASKS.reduce((s, t) => s + t.points, 0);
export const taskById = (id: string) => TASKS.find((t) => t.id === id);
export const tasksOf = (subject: Subject) => TASKS.filter((t) => t.subject === subject);
