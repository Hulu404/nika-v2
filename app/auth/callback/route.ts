import { NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token = searchParams.get("token");
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/day1";

  const supabase = await createServerComponentClient();

  // PKCE flow (code)
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/auth?error=auth`);
    }
    await upsertUser(data.user.id, data.user.email);
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Token flow (magiclink / email)
  if (token && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: type as "magiclink" | "email",
    });
    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/auth?error=auth`);
    }
    await upsertUser(data.user.id, data.user.email);
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/auth?error=missing_code`);
}

async function upsertUser(id: string, email?: string | null) {
  try {
    const admin = createServiceRoleClient();
    await admin
      .from("users")
      .upsert(
        { id, email: email ?? null },
        { onConflict: "id" }
      );
  } catch (err) {
    console.error("[auth/callback] users upsert failed:", err);
  }
}
