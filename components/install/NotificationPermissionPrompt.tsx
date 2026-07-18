'use client';

import { useEffect, useState } from 'react';
import { usePwaInstall } from '@/lib/hooks/usePwaInstall';
import { subscribeToPush } from '@/lib/push-subscribe';

export function NotificationPermissionPrompt() {
  const { isStandalone } = usePwaInstall();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStandalone) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem('nika_notif_soft_ask_shown')) return;
    setShow(true);
  }, [isStandalone]);

  const markShown = () => localStorage.setItem('nika_notif_soft_ask_shown', '1');

  const handleEnable = async () => {
    markShown();
    setShow(false);
    const perm = await Notification.requestPermission();
    // Разрешение без подписки на web-push бесполезно — крон-рассылке
    // некому слать. Подписываем устройство при согласии.
    if (perm === 'granted') subscribeToPush().catch(() => {});
  };

  const handleSkip = () => {
    markShown();
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-4 bottom-6 z-50 rounded-2xl bg-[#FAF7F1] p-5 shadow-lg">
      <p className="mb-1 font-serif text-[15px] text-[#1F1B16]">
        Напомнить, если пропустишь тренировку?
      </p>
      <p className="mb-4 text-[13px] leading-relaxed text-[#1F1B16]/60">
        Без спама — только когда действительно нужно.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleEnable}
          className="rounded-lg bg-[#C8553D] px-4 py-2 text-[13px] font-medium text-white"
        >
          Да, напоминай
        </button>
        <button onClick={handleSkip} className="px-4 py-2 text-[13px] text-[#1F1B16]/50">
          Не сейчас
        </button>
      </div>
    </div>
  );
}
