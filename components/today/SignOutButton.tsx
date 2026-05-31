"use client";

import { createClientComponentClient } from "@/lib/supabase";

export function SignOutButton() {
  async function handleSignOut() {
    const supabase = createClientComponentClient();
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-[var(--surface-deep)] hover:text-ink-primary"
    >
      Выйти
    </button>
  );
}
