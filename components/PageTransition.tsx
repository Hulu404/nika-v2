"use client";

import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in flex flex-col flex-1 min-h-0 overflow-hidden">
      {children}
    </div>
  );
}
