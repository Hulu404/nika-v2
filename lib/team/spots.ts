/**
 * Споты кофе-ранов для кнопок «Пятницы». Слаг — тот же, что в COFFEE_RUNS и в
 * coffee_run_signups.spot: по паре (спот, дата) экран ивента находит заявки.
 * Новый спот — строка здесь. «Другое место» вводится текстом.
 */
export interface Spot {
  slug: string;
  /** Коротко, для названия: «Кофе-ран · Усачёва». */
  name: string;
  address: string;
}

export const SPOTS: readonly Spot[] = [
  { slug: "usachevo", name: "Усачёва", address: "Москва, ул. Усачёва, 62" },
  { slug: "luzhniki", name: "Лужники", address: "Москва, ул. Лужники, 24, стр. 41" },
];

export function spotBySlug(slug: string | null | undefined): Spot | null {
  return SPOTS.find((s) => s.slug === slug) ?? null;
}

/** Название кофе-рана везде одно: «Кофе-ран · Усачёва» (или «Кофе-ран · <место>»). */
export function coffeeRunName(spotOrPlace: string): string {
  return `Кофе-ран · ${spotOrPlace}`;
}
