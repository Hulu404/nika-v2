import { AppLayout } from "@/components/AppLayout";
import { SidebarData } from "@/components/SidebarData";
import { UpgradeContent } from "@/components/UpgradeContent";

export default function UpgradePage() {
  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <UpgradeContent />
    </AppLayout>
  );
}
