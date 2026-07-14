import Anthropic from "@anthropic-ai/sdk";

const haiku = new Anthropic();
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type PushTrigger =
  | "scheduled"   // плановый чек-ин по расписанию
  | "inactive"    // 5+ дней без захода
  | "pre_run"     // перед стартом
  | "sprint_day"; // веха спринта (Pro)

interface PushContext {
  trigger: PushTrigger;
  name: string;
  gender: "male" | "female" | "neutral";
  daysSinceRun?: number;       // дней без пробежки
  daysSinceLogin?: number;     // дней без захода
  sprintDay?: number;          // день спринта
  sprintGoal?: string;         // цель спринта
  lastConvoTopic?: string;     // тема последнего диалога
}

const TEMPLATES: Record<PushTrigger, string[]> = {
  scheduled: [
    "Просто хотела сказать привет. Как ты сегодня?",
    "Просто заглянула. Если есть что рассказать — я тут.",
    "День идёт. Успеваешь?",
    "Не нужно бежать — если хочешь, напиши как ты.",
  ],
  inactive: [
    "Давно тебя не было. Это нормально — просто хочу, чтобы ты знал(а), что я тут.",
    "Пропустила тебя. Когда будешь готов(а) — напиши.",
    "Всё в порядке? Не пишу, чтобы вызвать вину — просто помню о тебе.",
  ],
  pre_run: [
    "Завтра твой день. Будь спокоен(на) сегодня вечером.",
    "Перед стартом: не думай пока о цифрах. Просто выйди.",
    "Всё готово? Можешь написать — поговорим.",
  ],
  sprint_day: [
    "Ты на {{day}} дне спринта. Как идёт?",
    "День {{day}} спринта. Хочешь, обсудим что было на этой неделе?",
  ],
};

function genderForm(gender: PushContext["gender"], male: string, female: string, neutral: string) {
  if (gender === "male") return male;
  if (gender === "female") return female;
  return neutral;
}

function pickTemplate(trigger: PushTrigger, sprintDay?: number): string {
  const pool = TEMPLATES[trigger];
  let tpl = pool[Math.floor(Math.random() * pool.length)];
  if (sprintDay) tpl = tpl.replace("{{day}}", String(sprintDay));
  return tpl;
}

export async function generatePushText(ctx: PushContext): Promise<{ title: string; body: string }> {
  const template = pickTemplate(ctx.trigger, ctx.sprintDay);

  const genderHint = genderForm(ctx.gender,
    "обращайся к нему в мужском роде",
    "обращайся к ней в женском роде",
    "используй нейтральное обращение без рода",
  );

  const contextLines = [
    `Имя пользователя: ${ctx.name || "не указано"}`,
    `Род: ${genderHint}`,
    ctx.daysSinceRun != null ? `Дней без пробежки: ${ctx.daysSinceRun}` : null,
    ctx.daysSinceLogin != null ? `Дней без захода в приложение: ${ctx.daysSinceLogin}` : null,
    ctx.sprintDay != null ? `День спринта: ${ctx.sprintDay}` : null,
    ctx.sprintGoal ? `Цель спринта: ${ctx.sprintGoal}` : null,
    ctx.lastConvoTopic ? `Тема последнего разговора: ${ctx.lastConvoTopic}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Ты НИКА — беговой компаньон. Тебе нужно написать короткое push-уведомление.

Контекст пользователя:
${contextLines}

Шаблон для адаптации: «${template}»

Правила:
— Адаптируй шаблон под контекст. Если есть имя — используй его (не обязательно в каждом сообщении).
— Тон живой, тёплый, без пафоса. Не бот, не коуч.
— Без тире (ни длинных ни коротких как пунктуация). Запятые и точки вместо тире.
— Без слов «эффективный», «уникальный», «поможет». Никаких ИИ-оборотов.
— Заголовок: 1-4 слова, не «НИКА пишет» — конкретнее.
— Тело: 1-2 предложения максимум.

Ответь строго в JSON без markdown:
{"title": "...", "body": "..."}`;

  try {
    const msg = await haiku.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    const parsed = JSON.parse(raw) as { title: string; body: string };
    if (parsed.title && parsed.body) return parsed;
  } catch (err) {
    console.error("[push-generate] Haiku failed:", err);
  }

  // Fallback без LLM
  return { title: "НИКА", body: template };
}
