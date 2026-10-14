"use client";

import { useState } from "react";
import { Bot, FileText, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminSettingsView } from "@/lib/types";
import { AiProviderSelector } from "./AiProviderSelector";
import { PromptEditor } from "./PromptEditor";
import { ModeSwitch } from "./ModeSwitch";
import { RiskSettingsForm } from "./RiskSettingsForm";
import { AutoTradeSettingsForm } from "./AutoTradeSettingsForm";
import { PriceSourceSelector } from "./PriceSourceSelector";

type TabId = "ai" | "prompts" | "risk";

const TABS: { id: TabId; label: string; icon: typeof Bot }[] = [
  { id: "ai", label: "AI Ayarları", icon: Bot },
  { id: "prompts", label: "Promptlar", icon: FileText },
  { id: "risk", label: "Risk & Mod", icon: ShieldCheck },
];

/**
 * Admin paneli ana form konteyneri — sekmeli düzen:
 * AI Ayarları / Promptlar / Risk & Mod.
 *
 * Ayarlar server component'ten (AdminSettingsView) alınır; her alt bileşen
 * kendi kısmi güncellemesini PUT /api/admin/settings'e gönderir ve güncel
 * görünümü onSaved callback'i ile parent'a yayar.
 */
export function SettingsForm({ initialSettings }: { initialSettings: AdminSettingsView }) {
  const [settings, setSettings] = useState<AdminSettingsView>(initialSettings);
  const [activeTab, setActiveTab] = useState<TabId>("ai");

  function handleSaved(next: AdminSettingsView) {
    setSettings(next);
  }

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 rounded-xl border border-gray-800 bg-gray-900/60 p-1" aria-label="Admin paneli sekmeleri">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
            )}
          >
            <tab.icon className="h-4 w-4" aria-hidden />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "ai" ? (
        <AiProviderSelector settings={settings} onSaved={handleSaved} />
      ) : null}
      {activeTab === "prompts" ? (
        <PromptEditor settings={settings} onSaved={handleSaved} />
      ) : null}
      {activeTab === "risk" ? (
        <div className="space-y-6">
          <ModeSwitch settings={settings} onSaved={handleSaved} />
          <PriceSourceSelector settings={settings} onSaved={handleSaved} />
          <AutoTradeSettingsForm settings={settings} onSaved={handleSaved} />
          <RiskSettingsForm settings={settings} onSaved={handleSaved} />
        </div>
      ) : null}
    </div>
  );
}
