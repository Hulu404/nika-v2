'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';

const COUNTER_ID = 109611856;

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

// Загрузчик tag.js + init. afterInteractive гарантирует запуск после гидрации,
// а не во время SSR (там window ещё нет). init сам отправляет первый хит.
const loader = `(function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}', 'ym');
ym(${COUNTER_ID}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", accurateTrackBounce:true, trackLinks:true});`;

/**
 * Отправляет hit при клиентской навигации. Без этого Метрика в SPA видит
 * только одну страницу за визит — init срабатывает единожды, а переходы
 * между экранами (чат ↔ профиль ↔ дневник) для неё «невидимы».
 */
function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Первый хит уже отправлен init'ом — не дублируем его.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const query = searchParams?.toString();
    const url = pathname + (query ? `?${query}` : '');
    window.ym?.(COUNTER_ID, 'hit', url);
  }, [pathname, searchParams]);

  return null;
}

export function YandexMetrika({ nonce }: { nonce?: string }) {
  return (
    <>
      <Script
        id="yandex-metrika"
        nonce={nonce}
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: loader }}
      />
      {/* useSearchParams требует Suspense-границу */}
      <Suspense fallback={null}>
        <RouteTracker />
      </Suspense>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${COUNTER_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
