import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Защита: заголовок X-Admin-Secret или cookie admin_secret */
function isAuthorized(): boolean {
  const hdrs = headers();
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const headerVal = hdrs.get("x-admin-secret");
  if (headerVal === secret) return true;

  // Браузер: читаем из cookie через заголовок Cookie
  const cookieHeader = hdrs.get("cookie") ?? "";
  const m = cookieHeader.match(/(?:^|;\s*)admin_secret=([^;]*)/);
  if (m && decodeURIComponent(m[1]) === secret) return true;

  return false;
}

export default async function AdminQrPage() {
  if (!isAuthorized()) {
    redirect("/");
  }

  const admin = createServiceRoleClient();

  // Воронка по кодам и дням (новые таблицы, типы ещё не сгенерированы)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any;
  const { data: funnel = [] } = await a.from("v_qr_funnel").select("*").order("day", { ascending: false }) as { data: Array<Record<string, unknown>> | null };

  // Справочник кодов для переключателя is_active
  type QrCode = { code: string; label: string; quota: number; grant_days: number; is_active: boolean };
  const { data: codes = [] } = await a.from("qr_codes").select("code, label, quota, grant_days, is_active").order("created_at") as { data: QrCode[] | null };

  // Сводка по кодам (агрегат)
  const summary: Record<string, {
    label: string; scans: number; unique: number; tokens: number;
    clicks: number; redeemed: number; active: number; expired: number; paid: number;
  }> = {};

  for (const row of funnel ?? []) {
    const k = row.code as string;
    if (!summary[k]) summary[k] = {
      label: row.label as string,
      scans: 0, unique: 0, tokens: 0,
      clicks: 0, redeemed: 0, active: 0, expired: 0, paid: 0,
    };
    const s = summary[k];
    s.scans    += Number(row.scans ?? 0);
    s.unique   += Number(row.unique_ips ?? 0);
    s.tokens   += Number(row.tokens_issued ?? 0);
    s.clicks   += Number(row.clicks ?? 0);
    s.redeemed += Number(row.redeemed ?? 0);
    s.active   += Number(row.promo_active ?? 0);
    s.expired  += Number(row.promo_expired ?? 0);
    s.paid     += Number(row.converted_to_paid ?? 0);
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "32px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>QR-промо · Воронка</h1>
      <p style={{ color: "#666", marginBottom: 32, fontSize: 14 }}>
        Данные обновляются при каждой загрузке. Переключение активности — через форму ниже.
      </p>

      {/* Сводная таблица по кодам */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Итого по кодам</h2>
      <div style={{ overflowX: "auto", marginBottom: 40 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {["Код","Метка","Сканы","Уник. IP","Токены","Клики","Погашено","Активны","Истекло","→Платно"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #ddd", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(summary).map(([code, s]) => (
              <tr key={code} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{code}</td>
                <td style={{ padding: "8px 12px", color: "#555" }}>{s.label}</td>
                <td style={{ padding: "8px 12px" }}>{s.scans}</td>
                <td style={{ padding: "8px 12px" }}>{s.unique}</td>
                <td style={{ padding: "8px 12px" }}>{s.tokens}</td>
                <td style={{ padding: "8px 12px" }}>{s.clicks}</td>
                <td style={{ padding: "8px 12px", color: s.redeemed > 0 ? "#2d6a2d" : undefined }}>{s.redeemed}</td>
                <td style={{ padding: "8px 12px" }}>{s.active}</td>
                <td style={{ padding: "8px 12px", color: "#999" }}>{s.expired}</td>
                <td style={{ padding: "8px 12px", color: s.paid > 0 ? "#B4553A" : undefined, fontWeight: s.paid > 0 ? 700 : 400 }}>{s.paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Управление кодами */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Управление кодами</h2>
      <div style={{ overflowX: "auto", marginBottom: 40 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {["Код","Метка","Квота","Дней Pro","Активен","Действие"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #ddd", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(codes ?? []).map(c => (
              <tr key={c.code} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{c.code}</td>
                <td style={{ padding: "8px 12px" }}>{c.label}</td>
                <td style={{ padding: "8px 12px" }}>{c.quota}</td>
                <td style={{ padding: "8px 12px" }}>{c.grant_days}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 10px", borderRadius: 12,
                    background: c.is_active ? "#d4edda" : "#f8d7da",
                    color: c.is_active ? "#155724" : "#721c24", fontWeight: 600, fontSize: 12,
                  }}>
                    {c.is_active ? "✓ Да" : "✗ Нет"}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <form action="/admin/qr/toggle" method="POST" style={{ display: "inline" }}>
                    <input type="hidden" name="code" value={c.code} />
                    <input type="hidden" name="is_active" value={String(!c.is_active)} />
                    <button
                      type="submit"
                      style={{
                        padding: "4px 14px", borderRadius: 8, border: "1px solid #ddd",
                        background: c.is_active ? "#fff3cd" : "#d4edda",
                        color: c.is_active ? "#856404" : "#155724",
                        cursor: "pointer", fontSize: 13, fontWeight: 600,
                      }}
                    >
                      {c.is_active ? "Отключить" : "Включить"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Детальная таблица по дням */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Детально по дням</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {["День","Код","Сканы","Уник.","Токены","Клики","Погашено","Активны","Истекло","→Платно"].map(h => (
                <th key={h} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "2px solid #ddd", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(funnel ?? []).map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: "#555" }}>
                  {new Date(row.day as string).toLocaleDateString("ru-RU")}
                </td>
                <td style={{ padding: "6px 10px", fontWeight: 600 }}>{row.code as string}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.scans ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.unique_ips ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.tokens_issued ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.clicks ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.redeemed ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.promo_active ?? 0)}</td>
                <td style={{ padding: "6px 10px", color: "#999" }}>{String(row.promo_expired ?? 0)}</td>
                <td style={{ padding: "6px 10px" }}>{String(row.converted_to_paid ?? 0)}</td>
              </tr>
            ))}
            {(!funnel || funnel.length === 0) && (
              <tr><td colSpan={10} style={{ padding: "24px", color: "#999", textAlign: "center" }}>Данных пока нет</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
