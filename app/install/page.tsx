import { AppLayout } from '@/components/AppLayout';
import { SidebarData } from '@/components/SidebarData';
import { PageHeader } from '@/components/nav/PageHeader';
import { InstallClient } from '@/components/install/InstallClient';

export default function InstallPage() {
  return (
    <AppLayout sidebarSlot={<SidebarData />}>
      <PageHeader title="Установить приложение" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[540px] px-5 pb-16 pt-8">
          <InstallClient />
        </div>
      </div>
    </AppLayout>
  );
}
