'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'nika_install_banner_dismissed_at';
const DISMISS_COOLDOWN_DAYS = 14;

export function useInstallBannerVisibility(readyToShow: boolean) {
  const [dismissed, setDismissed] = useState(true); // скрыт пока не проверили localStorage

  useEffect(() => {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) {
      setDismissed(false);
      return;
    }
    const daysSince = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
    setDismissed(daysSince < DISMISS_COOLDOWN_DAYS);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return { visible: readyToShow && !dismissed, dismiss };
}
