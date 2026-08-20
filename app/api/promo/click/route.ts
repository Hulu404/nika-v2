import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/** sendBeacon может прислать Blob с Content-Type application/json внутри multipart,
 *  или просто application/json — обрабатываем оба варианта. */
async function readBody(req: NextRequest): Promise<{ token?: string; code?: string; scan_id?: string }> {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return await req.json();
    }
    // sendBeacon с Blob — тело приходит как application/json внутри text/plain
    const text = await req.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    const token = (body.token ?? "").slice(0, 32);

    if (!token) return new NextResponse(null, { status: 204 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createServiceRoleClient() as any;
    await admin
      .from("promo_tokens")
      .update({ status: "clicked", clicked_at: new Date().toISOString() })
      .eq("token", token)
      .eq("status", "issued"); // только если ещё не кликали
  } catch (err) {
    // Ошибки здесь не должны ломать переход — глотаем и логируем
    console.error("[promo/click]", err);
  }

  return new NextResponse(null, { status: 204 });
}
