import type { MoodKey } from "@/types/app";
import type { RhythmBucket } from "@/lib/rhythm/buckets";
import { track } from "@/lib/track";

/**
 * События раздела «Мой ритм» (бриф §11). Полезная нагрузка — только структурные
 * значения: канонические ключи состояний и бакеты. Сырой текст заметки
 * (daily_state.note) сюда не попадает by design.
 */
export const rhythmAnalytics = {
  opened: () => track("rhythm_opened"),

  /** Состав отмеченных состояний + бакет (без сырого текста). */
  checkinCompleted: (moods: readonly MoodKey[], bucket: RhythmBucket) =>
    track("checkin_completed", { moods, count: moods.length, bucket }),

  nikaCardShown: (bucket: RhythmBucket) => track("nika_card_shown", { bucket }),

  discussInChatClicked: (bucket: RhythmBucket) =>
    track("discuss_in_chat_clicked", { bucket }),

  periodMarked: (marked: boolean) => track("period_marked", { marked }),

  dataDeleted: () => track("rhythm_data_deleted"),

  /** Согласие на хранение: дано/отклонено. */
  consent: (granted: boolean) =>
    track(granted ? "rhythm_consent_granted" : "rhythm_consent_declined", { granted }),
};
