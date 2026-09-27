/**
 * slug статьи справочника из заголовка — транслитом, под ^[a-z0-9-]{2,40}$
 * (check в databot_kb). Занят — добавляем -2, -3 и так далее.
 */

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export const SLUG_MAX = 40;
const FALLBACK = "statya";

export function slugify(title: string): string {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join("");
  const slug = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : FALLBACK;
}

/** Свободный slug: занятые — с суффиксом -2, -3…, всё в пределах 40 знаков. */
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
