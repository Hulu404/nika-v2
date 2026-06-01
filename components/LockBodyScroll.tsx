"use client";

import { useEffect } from "react";

/**
 * Запрещает прокрутку документа (html/body), пока смонтирован.
 * Нужен на страницах под AppLayout: они сами скроллят внутренние области
 * (h-dvh + overflow-y-auto), а document-скролл на мобильных браузерах
 * «отрывает» нижнюю панель ввода — браузер прокручивает страницу, чтобы
 * спрятать адресную строку, даже если контент помещается во вьюпорт.
 *
 * Восстанавливает прежние значения при размонтировании, поэтому страницы
 * без AppLayout (auth, onboarding) сохраняют обычную прокрутку документа.
 */
export function LockBodyScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const { body } = document;

    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
    };
  }, []);

  return null;
}
