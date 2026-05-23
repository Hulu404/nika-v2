import { useCallback, useRef } from "react";

/**
 * Автоматически подгоняет высоту textarea под содержимое.
 * Вызывай resize() в onInput/onChange поля ввода.
 */
export function useAutoResizeTextarea() {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  return { ref, resize };
}
