import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceRoleClient } from "@/lib/supabase-server";
import { LEGAL_VERSION, type ConsentType } from "@/lib/legal";

type Client = SupabaseClient<Database>;

export interface ConsentState {
  granted: boolean;
  version: string | null;
  at: string | null;
}

const EMPTY: ConsentState = { granted: false, version: null, at: null };

/** Текущее состояние согласий: последняя по времени строка каждого типа. */
export async function getConsentStates(
  supabase: Client,
  userId: string,
  types: readonly ConsentType[],
): Promise<Record<ConsentType, ConsentState>> {
  const out = {
    offer: EMPTY,
    pd: EMPTY,
    health: EMPTY,
    cookies_analytics: EMPTY,
  } as Record<ConsentType, ConsentState>;

  const { data } = await supabase
    .from("consents")
    .select("type, granted, version, created_at")
    .eq("user_id", userId)
    .in("type", [...types])
    .order("created_at", { ascending: false })
    .limit(50);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.type)) continue;
    seen.add(row.type);
    out[row.type] = { granted: row.granted, version: row.version, at: row.created_at };
  }
  return out;
}

export async function hasConsent(supabase: Client, userId: string, type: ConsentType): Promise<boolean> {
  const states = await getConsentStates(supabase, userId, [type]);
  return states[type].granted;
}

export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || null;
  const ua = req.headers.get("user-agent");
  return { ip, userAgent: ua ? ua.slice(0, 400) : null };
}

/** Добавляет строку в журнал (service role: пользователь не может писать сам). */
export async function recordConsents(
  userId: string,
  entries: { type: ConsentType; granted: boolean }[],
  meta: { ip: string | null; userAgent: string | null; source: string },
): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { error } = await admin.from("consents").insert(
    entries.map((e) => ({
      user_id: userId,
      type: e.type,
      version: LEGAL_VERSION,
      granted: e.granted,
      ip: meta.ip,
      user_agent: meta.userAgent,
      source: meta.source,
    })),
  );
  return error?.message ?? null;
}
