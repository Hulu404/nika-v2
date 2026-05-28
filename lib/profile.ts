import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Читает профиль пользователя или null, если его ещё нет. */
export async function getProfile(
  supabase: Client,
  userId: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Возвращает профиль пользователя, создавая пустую запись при первом обращении.
 * Принимает клиент параметром, чтобы переиспользоваться и в серверных
 * компонентах, и в middleware (у них разные инстансы Supabase-клиента).
 */
export async function getOrCreateProfile(
  supabase: Client,
  userId: string,
): Promise<Profile | null> {
  const existing = await getProfile(supabase, userId);
  if (existing) return existing;

  const { data } = await supabase
    .from("profiles")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return data ?? null;
}

/** Онбординг считается пройденным, когда выбрана цель бега. */
export function isProfileComplete(profile: Profile | null): boolean {
  return profile?.goal != null;
}
