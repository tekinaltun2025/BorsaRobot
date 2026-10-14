import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { PendingOrdersSection } from "@/components/admin/PendingOrdersSection";
import {
  getOrCreateAdminSettings,
  toAdminSettingsView,
} from "@/server/services/settings-service";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Yönetim Paneli",
};

export default async function AdminPage() {
  const settings = await getOrCreateAdminSettings();
  const view = toAdminSettingsView(settings);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Settings className="h-6 w-6 text-blue-500" aria-hidden />
            Yönetim Paneli
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            AI sağlayıcısı, model, analiz promptları, risk parametreleri ve
            çalışma modunu yapılandırın.
          </p>
        </div>
        <p className="text-xs text-gray-500">
          Son güncelleme: {formatDate(view.updatedAt)}
        </p>
      </header>

      <SettingsForm initialSettings={view} />
      <div className="mt-12">
        <PendingOrdersSection />
      </div>
    </div>
  );
}
