"use client";

import { useState } from "react";
import { FileText, RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_NEWS_SCAN_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "@/lib/constants";
import type { AdminSettingsUpdateInput, AdminSettingsView } from "@/lib/types";
import { FieldLabel, SaveStatus, SettingsCard, inputClass, useSaveStatus } from "./shared";

/**
 * Prompt yönetimi: hisse analiz ve haber tarama promptlarını textarea
 * üzerinden düzenler; varsayılana dön butonları içerir.
 */
export function PromptEditor({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [newsScanPrompt, setNewsScanPrompt] = useState(settings.newsScanPrompt);

  const systemDirty = systemPrompt !== settings.systemPrompt;
  const newsDirty = newsScanPrompt !== settings.newsScanPrompt;

  async function handleSave() {
    const update: AdminSettingsUpdateInput = {};
    if (systemDirty) update.systemPrompt = systemPrompt;
    if (newsDirty) update.newsScanPrompt = newsScanPrompt;
    if (Object.keys(update).length === 0) return;

    const result = await run(update);
    if (result) {
      onSaved({ ...settings, ...update } as AdminSettingsView);
    }
  }

  return (
    <SettingsCard
      title="Sistem Promptları"
      description="LLM analiz motorunun davranışını belirleyen talimatlardır. Çıktı JSON sözleşmesine (action/confidence/reasoning) sadık kalınmalıdır."
      icon={<FileText className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-6">
        <div>
          <FieldLabel
            htmlFor="system-prompt"
            label="Hisse Analiz Promptu"
            hint="Her analiz döngüsünde hisse + haber + fiyat verisiyle birleştirilir. Karar kurallarını burada tanımlayın."
          />
          <textarea
            id="system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={12}
            className={`${inputClass} mt-1.5 font-mono text-xs leading-relaxed`}
            spellCheck={false}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Varsayılana Dön
            </button>
            <span className="text-xs text-gray-500">
              {systemPrompt.length} karakter
            </span>
          </div>
        </div>

        <div>
          <FieldLabel
            htmlFor="news-scan-prompt"
            label="Haber Tarama Promptu"
            hint="Günlük haber akışının hisselerle eşleştirilmesi ve duygu sınıflandırması için kullanılır."
          />
          <textarea
            id="news-scan-prompt"
            value={newsScanPrompt}
            onChange={(e) => setNewsScanPrompt(e.target.value)}
            rows={10}
            className={`${inputClass} mt-1.5 font-mono text-xs leading-relaxed`}
            spellCheck={false}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNewsScanPrompt(DEFAULT_NEWS_SCAN_PROMPT)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Varsayılana Dön
            </button>
            <span className="text-xs text-gray-500">
              {newsScanPrompt.length} karakter
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!systemDirty && !newsDirty}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Save className="h-4 w-4" aria-hidden />
            Promptları Kaydet
          </button>
          <SaveStatus state={state} />
        </div>
      </div>
    </SettingsCard>
  );
}
