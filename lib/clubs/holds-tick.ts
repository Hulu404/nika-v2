import { tgAdmin } from "../telegram/supabase";
import { supabaseClubOrders } from "./orders";
import { expireHolds } from "./payments";

/**
 * Поминутный тикер (instrumentation.ts): неоплаченные заказы с истёкшим
 * холдом (20 минут) → expired, места снова продаются. Если по такому заказу
 * всё же придёт payment.succeeded, вебхук проверит вместимость и при
 * овербукинге вернёт деньги (lib/clubs/payments.ts).
 */
export async function tickClubHolds(now = new Date()): Promise<number> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0;
  return expireHolds({ orders: supabaseClubOrders(tgAdmin()), now: () => now });
}
