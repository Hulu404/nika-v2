/**
 * Конфиг раздела «Советы» (/tips): только словарь категорий, без контента.
 *
 * Контент теперь личный — приходит из personal_tips (советы, которые НИКА
 * сохранила из разговора). Статичной библиотеки больше нет. 'all' в CATEGORY_DEFS
 * означает фильтр «показать все», а не категорию совета.
 */

import type { TipCategory } from "@/types/app";

export type { TipCategory };

export interface CategoryDef {
  /** 'all' это фильтр «Все», прочие id это реальные категории советов. */
  id: "all" | TipCategory;
  label: string;
}

export const CATEGORY_DEFS: CategoryDef[] = [
  { id: "all", label: "Все" },
  { id: "before", label: "Перед бегом" },
  { id: "technique", label: "Техника" },
  { id: "breathing", label: "Дыхание" },
  { id: "gear", label: "Экипировка" },
  { id: "recovery", label: "Восстановление" },
  { id: "mindset", label: "Настрой" },
];

/** Подпись категории по id (включая 'all'). */
export function categoryLabel(id: CategoryDef["id"]): string {
  return CATEGORY_DEFS.find((c) => c.id === id)?.label ?? id;
}
