"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartY = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      const t = setTimeout(() => setShown(true), 12);
      return () => clearTimeout(t);
    } else {
      setShown(false);
      const t = setTimeout(() => { setMounted(false); setDragY(0); }, 340);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  const getTransform = () => {
    if (dragY > 0) return `translateY(${dragY}px)`;
    return shown ? "translateY(0)" : "translateY(100%)";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center lg:justify-center">
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-300",
          shown ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        style={{ transform: getTransform() }}
        className={cn(
          "relative w-full lg:max-w-md bg-elevated rounded-t-[24px] lg:rounded-[24px] max-h-[90vh] flex flex-col",
          !dragging && "transition-transform duration-300 ease-out",
        )}
        onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; setDragging(true); }}
        onTouchMove={(e) => {
          const delta = e.touches[0].clientY - touchStartY.current;
          if (delta > 0) setDragY(delta);
        }}
        onTouchEnd={() => {
          setDragging(false);
          if (dragY > 100) { setDragY(0); onClose(); }
          else setDragY(0);
        }}
      >
        <div className="flex flex-shrink-0 justify-center pt-3 pb-1">
          <div className="h-[5px] w-10 rounded-full bg-line-strong" />
        </div>
        <div className="flex flex-shrink-0 items-center justify-between px-5 pb-2 pt-3">
          <h3 className="text-[17px] font-semibold text-ink-primary">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-deep text-ink-muted transition-colors hover:text-ink-primary"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-8 pt-3">
          {children}
        </div>
      </div>
    </div>
  );
}
