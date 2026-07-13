'use client';

import { useEffect, useState, useCallback } from 'react';

export type Platform = 'ios' | 'android' | 'desktop' | 'unknown';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

// Instagram/TikTok/VK открывают ссылки во встроенном webview —
// Add to Home Screen там недоступен или обрезан
function detectInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ['instagram', 'fban', 'fbav', 'tiktok', 'musical_ly', 'vkclient', 'okhttp'].some((m) =>
    ua.includes(m)
  );
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayModeStandalone;
}

export function usePwaInstall() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsStandalone(detectStandalone());
    setIsInAppBrowser(detectInAppBrowser());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return 'unavailable' as const;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome;
  }, [deferredPrompt]);

  return {
    platform,
    isStandalone,
    isInAppBrowser,
    canPromptNative: !!deferredPrompt,
    promptInstall,
  };
}
