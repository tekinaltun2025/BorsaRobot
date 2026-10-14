"use client";

import { useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { RISK_LIMITS } from "@/lib/constants";
import type { AdminSettingsUpdateInput, AdminSettingsView } from "@/lib/types";
import { FieldLabel, SaveStatus, SettingsCard, inputClass, useSaveStatus } from "./shared";

/**
 * Risk yönetimi ayarları: stop-loss, take-profit, güven eşiği,
 * pozisyon limitleri, günlük bütçe ve cooldown.
 */
export function RiskSettingsForm({
  settings,
  onSaved,
}: {
  settings: AdminSettingsView;
  onSaved: (next: AdminSettingsView) => void;
}) {
  const { state, run } = useSaveStatus();
  const [form, setForm] = useState({
    stopLossPercent: String(settings.stopLossPercent),
    takeProfitPercent: String(settings.takeProfitPercent),
    minConfidenceThreshold: String(settings.minConfidenceThreshold),
    maxPositionValue: String(settings.maxPositionValue),
    maxOpenPositions: String(settings.maxOpenPositions),
    dailyOrderBudget: String(settings.dailyOrderBudget),
    cooldownMinutes: String(settings.cooldownMinutes),
    maxDailyLossLimit: String(settings.maxDailyLossLimit),
    maxBuyAmount: String(settings.maxBuyAmount),
    maxSellAmount: String(settings.maxSellAmount),
    autoTradeApprovalMode: settings.autoTradeApprovalMode,
  });

  const dirty =
    form.stopLossPercent !== String(settings.stopLossPercent) ||
    form.takeProfitPercent !== String(settings.takeProfitPercent) ||
    form.minConfidenceThreshold !== String(settings.minConfidenceThreshold) ||
    form.maxPositionValue !== String(settings.maxPositionValue) ||
    form.maxOpenPositions !== String(settings.maxOpenPositions) ||
    form.dailyOrderBudget !== String(settings.dailyOrderBudget) ||
    form.cooldownMinutes !== String(settings.cooldownMinutes) ||
    form.maxDailyLossLimit !== String(settings.maxDailyLossLimit) ||
    form.maxBuyAmount !== String(settings.maxBuyAmount) ||
    form.maxSellAmount !== String(settings.maxSellAmount) ||
    form.autoTradeApprovalMode !== settings.autoTradeApprovalMode;

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    const update: AdminSettingsUpdateInput = {
      stopLossPercent: Number(form.stopLossPercent),
      takeProfitPercent: Number(form.takeProfitPercent),
      minConfidenceThreshold: Number(form.minConfidenceThreshold),
      maxPositionValue: Number(form.maxPositionValue),
      maxOpenPositions: Number(form.maxOpenPositions),
      dailyOrderBudget: Number(form.dailyOrderBudget),
      cooldownMinutes: Number(form.cooldownMinutes),
      maxDailyLossLimit: Number(form.maxDailyLossLimit),
      maxBuyAmount: Number(form.maxBuyAmount),
      maxSellAmount: Number(form.maxSellAmount),
      autoTradeApprovalMode: form.autoTradeApprovalMode,
    };
    const result = await run(update);
    if (result) {
      onSaved({ ...settings, ...update } as AdminSettingsView);
    }
  }

  const numberFields = [
    {
      key: "stopLossPercent" as const,
      label: "Stop-Loss (%)",
      hint: `Pozisyon bu oranda zarara inerse otomatik satılır. ${RISK_LIMITS.stopLossPercent.min}–${RISK_LIMITS.stopLossPercent.max}`,
      step: "0.5",
    },
    {
      key: "takeProfitPercent" as const,
      label: "Take-Profit (%)",
      hint: `Pozisyon bu oranda kâra ulaşırsa otomatik satılır. ${RISK_LIMITS.takeProfitPercent.min}–${RISK_LIMITS.takeProfitPercent.max}`,
      step: "0.5",
    },
    {
      key: "minConfidenceThreshold" as const,
      label: "Minimum Güven Skoru",
      hint: `AI analizinin emir üretmesi için gereken alt eşik (0–1). ${RISK_LIMITS.minConfidenceThreshold.min}–${RISK_LIMITS.minConfidenceThreshold.max}`,
      step: "0.05",
    },
    {
      key: "maxPositionValue" as const,
      label: "Maks. Pozisyon Tutarı (TL)",
      hint: `Tek bir hissedede taahhüt edilebilecek azami tutar. ${RISK_LIMITS.maxPositionValue.min.toLocaleString("tr-TR")}–${RISK_LIMITS.maxPositionValue.max.toLocaleString("tr-TR")}`,
      step: "1000",
    },
    {
      key: "maxOpenPositions" as const,
      label: "Maks. Açık Pozisyon",
      hint: `Eşzamanlı tutulabilecek azami pozisyon sayısı. ${RISK_LIMITS.maxOpenPositions.min}–${RISK_LIMITS.maxOpenPositions.max}`,
      step: "1",
    },
    {
      key: "dailyOrderBudget" as const,
      label: "Günlük Emir Bütçesi (TL)",
      hint: `Bir günde toplam emirlere ayrılan bütçe. ${RISK_LIMITS.dailyOrderBudget.min.toLocaleString("tr-TR")}–${RISK_LIMITS.dailyOrderBudget.max.toLocaleString("tr-TR")}`,
      step: "1000",
    },
    {
      key: "cooldownMinutes" as const,
      label: "Analiz Cooldown (dakika)",
      hint: `Aynı hisse için iki analiz arası minimum süre. ${RISK_LIMITS.cooldownMinutes.min}–${RISK_LIMITS.cooldownMinutes.max}`,
      step: "5",
    },
    {
      key: "maxDailyLossLimit" as const,
      label: "Günlük Maks. Zarar Limiti (TRY)",
      hint: `Günlük toplam zarar bu tutarı aşarsa işlemler durdurulur. ${RISK_LIMITS.maxDailyLossLimit.min.toLocaleString("tr-TR")}–${RISK_LIMITS.maxDailyLossLimit.max.toLocaleString("tr-TR")}`,
      step: "100",
    },
    {
      key: "maxBuyAmount" as const,
      label: "Maks. Alış Tutarı (TRY)",
      hint: `Tek bir alış emrinin maksimum tutarı. ${RISK_LIMITS.maxBuyAmount.min.toLocaleString("tr-TR")}–${RISK_LIMITS.maxBuyAmount.max.toLocaleString("tr-TR")}`,
      step: "100",
    },
    {
      key: "maxSellAmount" as const,
      label: "Maks. Satış Tutarı (TRY)",
      hint: `Tek bir satış emrinin maksimum tutarı. ${RISK_LIMITS.maxSellAmount.min.toLocaleString("tr-TR")}–${RISK_LIMITS.maxSellAmount.max.toLocaleString("tr-TR")}`,
      step: "100",
    },
  ];

  return (
    <SettingsCard
      title="Risk Yönetimi"
      description="Otomatik alım-satım motorunun uyması zorunlu guard'ları. Tüm kurallar geçilmedikçe emir üretilmez."
      icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {numberFields.map((field) => (
            <div key={field.key}>
              <FieldLabel htmlFor={field.key} label={field.label} hint={field.hint} />
              <input
                id={field.key}
                type="number"
                inputMode="decimal"
                step={field.step}
                min={0}
                value={form[field.key]}
                onChange={(e) => update(field.key, e.target.value)}
                className={`${inputClass} mt-1.5 tabular-nums`}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="autoTradeApprovalMode" label="Otomatik İşlem Modu" hint="MANUAL (onay gerektirir) veya AUTO (doğrudan uygular)." />
            <select
              id="autoTradeApprovalMode"
              value={form.autoTradeApprovalMode}
              onChange={(e) => update("autoTradeApprovalMode", e.target.value)}
              className={`${inputClass} mt-1.5`}
            >
              <option value="MANUAL">MANUAL (Onay Gerektirir)</option>
              <option value="AUTO">AUTO (Doğrudan Uygula)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Save className="h-4 w-4" aria-hidden />
            Risk Ayarlarını Kaydet
          </button>
          <SaveStatus state={state} />
        </div>
      </div>
    </SettingsCard>
  );
}
