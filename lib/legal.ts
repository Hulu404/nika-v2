/** Редакция юридических документов (/legal/*). Меняется вместе с текстом в public/legal. */
export const LEGAL_VERSION = "2026-09-30";

export const CONSENT_TYPES = ["offer", "pd", "health", "cookies_analytics"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export function isConsentType(v: unknown): v is ConsentType {
  return typeof v === "string" && (CONSENT_TYPES as readonly string[]).includes(v);
}
