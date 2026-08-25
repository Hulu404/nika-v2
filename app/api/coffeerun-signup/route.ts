import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, contact, email, source, run_date } = body as Record<string, string>;

  if (!name || !contact || !email) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 422 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Дата забега: берём из формы, если пришла валидная YYYY-MM-DD.
  // Иначе не передаём — сработает default столбца run_date в БД.
  const runDate = /^\d{4}-\d{2}-\d{2}$/.test(String(run_date || "")) ? String(run_date) : null;

  const { error } = await supabase.from("coffee_run_signups").insert({
    name: String(name).trim().slice(0, 200),
    contact: String(contact).trim().slice(0, 200),
    email: String(email).trim().slice(0, 200),
    source: String(source || "coffeerunsurfsport").slice(0, 100),
    ...(runDate ? { run_date: runDate } : {}),
  });

  if (error) {
    console.error("coffee_run_signups insert error:", error.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
