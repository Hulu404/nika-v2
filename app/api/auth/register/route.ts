import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    console.log("[register] called, email:", email);

    if (!email || !password) {
      return NextResponse.json({ error: "Email и пароль обязательны." }, { status: 400 });
    }

    const admin = createServiceRoleClient();

    console.log("[register] calling admin.auth.admin.createUser...");

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    console.log("[register] result:", { data: data?.user?.id, error });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ userId: data.user.id });
  } catch (err) {
    console.error("[register] unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
