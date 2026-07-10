import type { MoodKey } from "@/types/app";
import { MOOD_LABELS } from "@/lib/rhythm-copy";
import { BUCKET_LABELS, resolveBucket } from "@/lib/rhythm/buckets";
import { bucketReply } from "@/lib/rhythm/replies";

/**
 * Динамический блок <rhythm_context> для системного промпта чата. Передаёт в
 * серверный диалоговый слой состояние дня (чипы + факт бег/пропуск + бакет) и
 * жёсткие границы генерации (бриф §2, §6). Полная реплика бакета идёт как опора
 * тона на старте треда — Ника говорит своими словами, тем же голосом.
 *
 * Добавляется ПОСЛЕ кэшируемого статичного префикса (как buildSprintContext).
 */
export function buildRhythmContext(moods: MoodKey[], ran: boolean | null): string {
  const skip = ran === false;
  const bucket = resolveBucket(moods, { skip });
  const reply = bucketReply(bucket);
  const chips = moods.map((m) => MOOD_LABELS[m]).join(", ") || "ничего не отметила";

  const lines = [
    "<rhythm_context>",
    `Сегодня она отметила состояние: ${chips}.`,
    ran === false ? "Сегодня пробежки не было." : ran === true ? "Сегодня пробежка была." : null,
    `Настрой дня: ${BUCKET_LABELS[bucket]}.`,
    `Опора тона на старте (передай смысл своими словами, не цитируй дословно): «${reply.full}»`,
    "Границы (соблюдай строго):",
    "— Не назначай план, темп, дистанцию или пульс. Только мягко предлагай, выбор за ней.",
    "— Без медицинских формулировок, диагнозов и темы контрацепции.",
    "— Не называй день цикла и фазы, не делай прогнозов вида «завтра будет фаза X».",
    "— Без вины и токсичного позитива. Коротко, живым человеческим тоном.",
    "</rhythm_context>",
  ].filter(Boolean);

  return lines.join("\n");
}
