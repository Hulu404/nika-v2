import type { Metadata } from "next";
import { ActivateClient } from "./ActivateClient";

export const metadata: Metadata = {
  title: "Активация Pro · НИКА",
  description: "Pro-доступ к НИКЕ на 21 день. Без карты и списаний.",
  robots: { index: false, follow: false },
};

export default function ActivatePage() {
  return <ActivateClient />;
}
