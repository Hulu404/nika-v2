"use client";

import { useEffect } from "react";

/** Является ли элемент текстовым полем (то есть открывает экранную клавиатуру). */
function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const t = (el as HTMLInputElement).type;
  return !["button", "submit", "reset", "checkbox", "radio", "range", "file", "color", "image"].includes(t);
}

/**
 * Насколько низ layout-вьюпорта должен быть съеден, чтобы считать это
 * клавиатурой. Прячущаяся адресная строка Safari забирает ~60px — её
 * принимать за клавиатуру нельзя, иначе высота будет прыгать при скролле.
 */
const KEYBOARD_MIN_OVERLAP = 120;

/**
 * Приводит макет в соответствие с экранной клавиатурой. Держит на <html> две
 * вещи, на которые опирается CSS:
 *
 *   • класс keyboard-open — сворачивает --tabbar-h в ноль (таб-бар на время
 *     ввода прячется, и его резерв не должен оставаться дырой над клавиатурой);
 *   • --app-h и --app-top — высоту видимой части экрана и её смещение вниз
 *     относительно верха layout-вьюпорта (см. .app-shell в globals.css).
 *
 * Зачем --app-h вообще нужна: 100dvh при открытии клавиатуры НЕ уменьшается ни
 * на iOS, ни в Chrome с дефолтным interactive-widget=resizes-visual. Контейнер
 * остаётся во весь экран, поле ввода уезжает под клавиатуру, и браузер
 * прокручивает visual-вьюпорт, чтобы его показать — поле «улетает» на середину.
 *
 * Переопределяем --app-h только пока клавиатура реально перекрывает экран.
 * В остальное время работает CSS-дефолт 100dvh: он сам отслеживает адресную
 * строку, и дублировать это через JS значит ловить дрожание на каждом скролле.
 * На Android с resizes-content (см. viewport в app/layout.tsx) window.innerHeight
 * ужимается вместе с visualViewport, перекрытие выходит нулевым — и там всё
 * делает нативный dvh, сюда мы не вмешиваемся.
 */
export function KeyboardInsets() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    // ── клавиатура открыта: по фокусу ──────────────────────────────────────
    // Именно по фокусу, а не по высоте: это единственный признак, который
    // работает и там, где вьюпорт ужимается сам (resizes-content) и перекрытия
    // не остаётся. Таб-бар прячется по тому же классу — рассинхрону взяться неоткуда.
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target)) root.classList.add("keyboard-open");
    };
    const onFocusOut = () => {
      // Отложенно: при переходе между полями focusout→focusin не мигаем.
      setTimeout(() => {
        if (!isTextField(document.activeElement)) root.classList.remove("keyboard-open");
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    // ── высота видимой части ───────────────────────────────────────────────
    let raf = 0;
    const applyHeight = () => {
      if (!vv) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // При пинч-зуме visualViewport тоже ужимается, но клавиатуры там нет —
        // приняв это за неё, мы бы обрезали приложение до части экрана.
        // (iOS даёт зумить даже при user-scalable=no, ради доступности.)
        if (vv.scale > 1) return;

        // Ровно то, что съедено снизу: offsetTop тут вычитать нельзя. Это не
        // часть перекрытия, а подъём экрана к полю — при большом подъёме
        // перекрытие ушло бы под порог, мы бы отпустили высоту, поле снова
        // нырнуло под клавиатуру, iOS поднял бы экран ещё раз. Компенсируем
        // подъём отдельно, через --app-top.
        const overlap = window.innerHeight - vv.height;
        if (overlap > KEYBOARD_MIN_OVERLAP) {
          root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
          root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
          // Там, где документ всё-таки скроллится (онбординг — он без
          // LockBodyScroll), iOS подтягивает к полю страницу. Возвращаем её на
          // место: каркас в fixed, и сдвинутым остался бы только фон под ним.
          // Условие гасит цикл scroll → scrollTo → scroll.
          if (window.scrollY !== 0) window.scrollTo(0, 0);
        } else {
          root.style.removeProperty("--app-h");
          root.style.removeProperty("--app-top");
        }
      });
    };

    vv?.addEventListener("resize", applyHeight);
    vv?.addEventListener("scroll", applyHeight);
    applyHeight();

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      vv?.removeEventListener("resize", applyHeight);
      vv?.removeEventListener("scroll", applyHeight);
      cancelAnimationFrame(raf);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
    };
  }, []);

  return null;
}
