import { UpgradeContent } from "@/components/UpgradeContent";

/**
 * Экран апсейла Free → PRO. Полноэкранный оверлей на всю ширину вьюпорта: без
 * сайдбара и таб-бара (собственный крестик закрытия внутри UpgradeContent).
 * Единая точка входа апсейла — сюда ведут сайдбар, профиль и fail-страница оплаты.
 */
export default function UpgradePage() {
  return <UpgradeContent />;
}
