"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@/lib/supabase";

/**
 * Плавающее меню в правом верхнем углу: показывает email и кнопку выхода —
 * только если пользователь авторизован. Позиционируется fixed, поэтому не
 * влияет на раскладку страниц (в т.ч. на полноэкранный экран чата).
 */
export function UserMenu() {
  const router = useRouter();
  const [supabase] = useState(() => createClientComponentClient());
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (!email) return null;

  async function signOut() {
    await supabase.auth.signOut();
    setEmail(null);
    router.push("/auth");
    router.refresh();
  }

  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
      <span className="hidden max-w-[12rem] truncate text-sm text-ink-secondary sm:inline">
        {email}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="rounded-pill border border-line-default bg-elevated px-3 py-1.5 text-sm text-ink-primary backdrop-blur transition-colors hover:bg-surface-warm"
      >
        Выйти
      </button>
    </div>
  );
}
