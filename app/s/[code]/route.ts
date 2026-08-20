import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Railway ставит реальный IP в X-Forwarded-For. Берём первый адрес в цепочке. */
function extractIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "nika-qr-salt";
  return createHash("sha256").update(ip + salt).digest("hex").slice(0, 16);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const code = (params.code ?? "").toUpperCase().slice(0, 32);
  const admin = createServiceRoleClient();

  // Проверяем, что код существует и активен
  const { data: qr } = await admin
    .from("qr_codes")
    .select("code, is_active")
    .eq("code", code)
    .maybeSingle();

  if (!qr || !qr.is_active) {
    // Код неизвестен — тихий редирект на главную без технических деталей
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Пишем скан
  const ip = extractIp(req);
  const { data: scan } = await admin
    .from("qr_scans")
    .insert({
      code,
      ip_hash: hashIp(ip),
      user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
      referer: req.headers.get("referer")?.slice(0, 512) ?? null,
    })
    .select("id")
    .single();

  const scanId = scan?.id ?? "";

  // Редирект на страницу активации
  const dest = new URL("/activate", req.url);
  dest.searchParams.set("c", code);
  if (scanId) dest.searchParams.set("s", scanId);

  const res = NextResponse.redirect(dest, 302);

  const cookieOpts = {
    maxAge: 60 * 60 * 24 * 30, // 30 дней
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // страница читает через JS
  };
  res.cookies.set("nika_src", code, cookieOpts);
  if (scanId) res.cookies.set("nika_scan", scanId, cookieOpts);

  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}
