import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  if (req.headers.get("x-admin-secret") === secret) return true;
  const cookieVal = req.cookies.get("admin_secret")?.value;
  return cookieVal === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const form = await req.formData();
  const code = (form.get("code") as string ?? "").toUpperCase().slice(0, 32);
  const isActive = form.get("is_active") === "true";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any;
  await admin.from("qr_codes").update({ is_active: isActive }).eq("code", code);

  return NextResponse.redirect(new URL("/admin/qr", req.url), 303);
}
