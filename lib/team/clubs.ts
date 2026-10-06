/**
 * Клубы НИКИ, у которых бывают ивенты. Новый клуб — одна строка здесь:
 * ключ уходит в team_events.club и в callback_data кнопок, поэтому короткий
 * и латиницей.
 */
export interface Club {
  key: string;
  name: string;
  /** Значок в списках ивентов и расписании. */
  icon: string;
}

export const CLUBS: readonly Club[] = [
  { key: "run", name: "Беговой клуб", icon: "🏃" },
];

/** Клуб кофе-ранов из COFFEE_RUNS. */
export const COFFEE_RUN_CLUB = "run";

export function clubByKey(key: string | null | undefined): Club | null {
  return CLUBS.find((c) => c.key === key) ?? null;
}
