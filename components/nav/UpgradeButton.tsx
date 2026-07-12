import Link from "next/link";
import { createServerComponentClient } from "@/lib/supabase";
import { resolveIsPro } from "@/lib/subscription";

/**
 * Вход на экран апсейла из шапки раздела. Показывается только не-Pro и только на
 * мобайле (lg:hidden) — на десктопе вход в PRO живёт в промо-блоке сайдбара.
 * Выделенная акцентная точка (не равная вкладка), иконка в стиле нав-набора:
 * обводка без заливки, currentColor, stroke 1.5.
 */
export async function UpgradeButton() {
  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isPro = resolveIsPro(undefined);
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", user.id)
      .maybeSingle();
    isPro = resolveIsPro(data?.is_pro);
  }
  if (isPro) return null;

  return (
    <Link
      href="/upgrade"
      aria-label="Перейти на PRO"
      className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-pill border border-accent-soft bg-surface-warm px-3 text-accent transition-colors hover:bg-surface-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:hidden"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M10 2.6c.7 3.5 1.9 4.7 5.4 5.4-3.5.7-4.7 1.9-5.4 5.4-.7-3.5-1.9-4.7-5.4-5.4 3.5-.7 4.7-1.9 5.4-5.4Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M15.5 13.5c.28 1.35.75 1.82 2.1 2.1-1.35.28-1.82.75-2.1 2.1-.28-1.35-.75-1.82-2.1-2.1 1.35-.28 1.82-.75 2.1-2.1Z"
          stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">PRO</span>
    </Link>
  );
}
