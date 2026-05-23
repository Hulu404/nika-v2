import { useEffect, useRef } from "react";

/**
 * Держит контейнер диалога прокрученным вниз при изменении зависимости
 * (например, при добавлении нового сообщения).
 */
export function useChatScroll<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dep]);

  return ref;
}
