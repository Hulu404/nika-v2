'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';

const GA_ID = 'G-ZWBYL9Z5L7';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Инициализация gtag. afterInteractive — запуск после гидрации (не на SSR).
// gtag('config') сам отправляет первый page_view.
const initScript = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`;

/**
 * Отправляет page_view при клиентской навигации. В SPA gtag config считает
 * страницу только раз при загрузке — переходы между экранами (чат ↔ профиль ↔
 * дневник) иначе для GA невидимы.
 */
function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Первый page_view уже отправлен config'ом — не дублируем его.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const query = searchParams?.toString();
    const path = pathname + (query ? `?${query}` : '');
    window.gtag?.('event', 'page_view', {
      page_path: path,
      page_location: window.location.href,
    });
  }, [pathname, searchParams]);

  return null;
}

export function GoogleAnalytics({ nonce }: { nonce?: string }) {
  return (
    <>
      <Script
        id="ga-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        nonce={nonce}
        strategy="afterInteractive"
      />
      <Script
        id="ga-init"
        nonce={nonce}
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: initScript }}
      />
      {/* useSearchParams требует Suspense-границу */}
      <Suspense fallback={null}>
        <RouteTracker />
      </Suspense>
    </>
  );
}
