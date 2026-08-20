import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/** Алфавит без визуально похожих символов: 0, O, 1, I, L исключены. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomChar(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function generateToken(prefix: string): string {
  const suffix = Array.from({ length: 4 }, randomChar).join("");
  return `${prefix}-${suffix}`;
}

export async function POST(req: NextRequest) {
  let body: { code?: string; scan_id?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const code = (body.code ?? "").toUpperCase().trim().slice(0, 32);
  const scanId = body.scan_id ?? null;

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Проверяем код
  const { data: qr } = await admin
    .from("qr_codes")
    .select("code, quota, grant_days, is_active")
    .eq("code", code)
    .maybeSingle();

  if (!qr || !qr.is_active) {
    return NextResponse.json({ error: "Promo closed" }, { status: 410 });
  }

  // Идемпотентность: если этот scan_id уже получил токен — возвращаем тот же
  if (scanId) {
    const { data: existing } = await admin
      .from("promo_tokens")
      .select("token, token_valid_until, grant_days")
      .eq("scan_id", scanId)
      .maybeSingle();

    if (existing) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + existing.grant_days);
      return NextResponse.json({
        token: existing.token,
        expires_at: expiresAt.toISOString(),
        token_valid_until: existing.token_valid_until,
      });
    }
  }

  // Проверяем квоту: сколько токенов уже выдано по этому коду
  const { count } = await admin
    .from("promo_tokens")
    .select("*", { count: "exact", head: true })
    .eq("code", code);

  if ((count ?? 0) >= qr.quota) {
    return NextResponse.json({ error: "Quota exceeded" }, { status: 410 });
  }

  // Rate limit по ip_hash: не более 10 выдач в час с одного IP
  // Берём ip_hash из записи скана (если scan_id есть)
  if (scanId) {
    const { data: scanRow } = await admin
      .from("qr_scans")
      .select("ip_hash")
      .eq("id", scanId)
      .maybeSingle();

    if (scanRow?.ip_hash) {
      const { data: rl } = await admin.rpc("check_rate_limit", {
        p_key: `promo_issue:${scanRow.ip_hash}`,
        p_limit: 10,
        p_window_seconds: 3600,
      });
      if (!rl) {
        return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
      }
    }
  }

  // Генерируем уникальный токен (до 5 попыток при коллизии)
  const now = new Date();
  const tokenValidUntil = new Date(now);
  tokenValidUntil.setDate(tokenValidUntil.getDate() + 14);

  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + qr.grant_days);

  let token = "";
  const prefix = code.replace(/[^A-Z0-9]/g, "").slice(0, 6);

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateToken(prefix);
    const { error } = await admin.from("promo_tokens").insert({
      token: candidate,
      code,
      scan_id: scanId ?? null,
      grant_days: qr.grant_days,
      token_valid_until: tokenValidUntil.toISOString(),
    });
    if (!error) {
      token = candidate;
      break;
    }
    // Если ошибка уникальности по scan_id — вернуть существующий
    if (scanId && error.code === "23505") {
      const { data: race } = await admin
        .from("promo_tokens")
        .select("token, token_valid_until, grant_days")
        .eq("scan_id", scanId)
        .maybeSingle();
      if (race) {
        const raceExpiry = new Date();
        raceExpiry.setDate(raceExpiry.getDate() + race.grant_days);
        return NextResponse.json({
          token: race.token,
          expires_at: raceExpiry.toISOString(),
          token_valid_until: race.token_valid_until,
        });
      }
    }
  }

  if (!token) {
    return NextResponse.json({ error: "Token generation failed" }, { status: 500 });
  }

  return NextResponse.json({
    token,
    expires_at: expiresAt.toISOString(),
    token_valid_until: tokenValidUntil.toISOString(),
  });
}
