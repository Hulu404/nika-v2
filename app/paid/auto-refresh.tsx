"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Пока заказ ждёт подтверждения оплаты, страница сама перезапрашивает статус
 * (сервер при каждом запросе сверяет его с ЮKassa). Не дольше пары минут.
 */
export function AutoRefresh({ everyMs = 4000, maxTimes = 30 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > maxTimes) clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, maxTimes]);
  return null;
}
