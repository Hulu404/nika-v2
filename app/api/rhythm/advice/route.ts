import { anthropic } from "@/lib/anthropic";
import { createServerComponentClient } from "@/lib/supabase";
import { getLatestCycles, getTodayCheckin, getCycleLength, getCycleDay, getPhase, PHASE_META } from "@/lib/rhythm/cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Возвращает дату YYYY-MM-DD по серверному UTC. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST() {
  const supabase = await createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayUtc();

  // Уже есть совет на сегодня?
  const { data: existing } = await supabase
    .from("rhythm_daily_advice")
    .select("advice_short, advice_full")
    .eq("user_id", user.id)
    .eq("date", today)
    .maybeSingle();

  if (existing) return Response.json(existing);

  // Получаем данные цикла
  const cycles = await getLatestCycles(supabase, user.id, 5);
  if (cycles.length === 0) {
    return Response.json({ error: "No cycle data" }, { status: 404 });
  }

  const cycleLen = getCycleLength(cycles);
  const cycleDay = getCycleDay(cycles[0].started_at, today);
  const phase = getPhase(cycleDay, cycleLen);
  const phaseRu = PHASE_META[phase].labelRu;

  // Вчерашний чек-ин
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const checkin = await getTodayCheckin(supabase, user.id, yesterdayStr);
  const checkinStr = checkin?.tags?.length
    ? checkin.tags.join(", ") + (checkin.note ? ` («${checkin.note}»)` : "")
    : "нет данных";

  // Имя пользователя
  const { data: userData } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const name = userData?.display_name || "бегунья";

  const prompt = `Ты — Ника, беговой компаньон. Напиши персональный совет на сегодня.

Данные:
— Имя: ${name}
— Форма обращения: женская
— День цикла: ${cycleDay} из ${cycleLen}
— Фаза: ${phaseRu}
— Вчерашний чек-ин: ${checkinStr}

Ответь строго JSON без markdown и пояснений:
{"advice_short":"1-2 предложения","advice_full":"2-4 предложения"}

Требования к тексту:
— Голос Ники: тёплый, конкретный, живой. Без ИИ-клише (избегай «безусловно», «конечно», «однако», «кроме того», «важно отметить»)
— Без тире в начале предложений, без перечислений через «—»
— Одно конкретное практическое действие на сегодня
— Только бег, темп, сон, восстановление. Никаких медицинских рекомендаций
— advice_short — первые 1-2 предложения для карточки на Главной
— advice_full — полный текст для страницы ритма`;

  let adviceShort = "";
  let adviceFull = "";

  try {
    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    const parsed = JSON.parse(text) as { advice_short: string; advice_full: string };
    adviceShort = parsed.advice_short;
    adviceFull = parsed.advice_full;
  } catch {
    // Fallback на словарь фаз
    adviceFull = PHASE_META[phase].lede;
    adviceShort = adviceFull.split(". ").slice(0, 2).join(". ") + ".";
  }

  // Кэшируем в БД (service_role — RLS разрешает)
  await supabase.from("rhythm_daily_advice").upsert(
    { user_id: user.id, date: today, phase, cycle_day: cycleDay, advice_short: adviceShort, advice_full: adviceFull },
    { onConflict: "user_id,date" },
  );

  return Response.json({ advice_short: adviceShort, advice_full: adviceFull });
}
