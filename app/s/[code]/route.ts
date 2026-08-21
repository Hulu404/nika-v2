import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Railway проксирует через localhost:8080 → req.url содержит внутренний хост.
 *  Берём реальный origin из X-Forwarded-Host / Host. */
function getPublicOrigin(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "www.mynika.online";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

/** Railway ставит реальный IP в X-Forwarded-For. Берём первый адрес в цепочке. */
function extractIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** SHA-256 (64 hex-символа) от IP + соль. Сырой IP нигде не хранится. */
function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "nika-qr-salt";
  return createHash("sha256").update(ip + salt).digest("hex"); // 64 символа
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const code = (params.code ?? "").toUpperCase().slice(0, 32);
  const origin = getPublicOrigin(req);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createServiceRoleClient() as any;

  // ── 1. Проверяем код ──────────────────────────────────────────────────────
  let qr: { code: string; is_active: boolean } | null = null;
  try {
    const { data } = await admin
      .from("qr_codes")
      .select("code, is_active")
      .eq("code", code)
      .maybeSingle();
    qr = data;
  } catch (err) {
    console.error("[/s] qr_codes lookup error:", err);
  }

  if (!qr || !qr.is_active) {
    // Неизвестный или отключённый код — тихий 302 на главную без деталей
    return NextResponse.redirect(new URL("/", origin), 302);
  }

  // ── 2. Пишем скан (ошибка не ломает переход) ─────────────────────────────
  const ip = extractIp(req);
  const ipHash = hashIp(ip);

  let scanId = "";
  try {
    const { data: scan, error: scanErr } = await admin
      .from("qr_scans")
      .insert({
        code,
        ip_hash: ipHash,
        user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
        referer: req.headers.get("referer")?.slice(0, 512) ?? null,
      })
      .select("id")
      .single();

    if (scanErr) {
      console.error("[/s] qr_scans insert error:", scanErr.message);
    } else {
      scanId = scan?.id ?? "";
    }
  } catch (err) {
    console.error("[/s] qr_scans unexpected error:", err);
  }

  // ── 3. Редирект на страницу активации ────────────────────────────────────
  const dest = new URL("/activate", origin);
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
