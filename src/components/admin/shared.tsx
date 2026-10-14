"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminSettingsUpdateInput, AdminSettingsView } from "@/lib/types";

/** Tek sekmelik form alanı grubunu saran kart bileşeni. */
export function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60">
      <header className="flex items-start gap-3 border-b border-gray-800 p-5">
        <span className="mt-0.5 text-blue-500">{icon}</span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-gray-400">{description}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Tutarlı stillendirilmiş form etiketi + açıklama. */
export function FieldLabel({
  htmlFor,
  label,
  hint,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-200">
      {label}
      {hint ? <span className="mt-0.5 block text-xs font-normal text-gray-500">{hint}</span> : null}
    </label>
  );
}

/** Tutarlı input stili. */
export const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-blue-500 focus:outline-none disabled:opacity-50";

/** Kaydetme durumu göstergesi. */
export function SaveStatus({
  state,
}: {
  state: { kind: "idle" | "saving" | "success" | "error"; message?: string };
}) {
  if (state.kind === "idle") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        state.kind === "success" && "bg-emerald-950/60 text-emerald-300",
        state.kind === "error" && "bg-red-950/60 text-red-300",
        state.kind === "saving" && "bg-gray-800/60 text-gray-300",
      )}
    >
      {state.kind === "saving" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : state.kind === "success" ? (
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      ) : (
        <AlertCircle className="h-4 w-4" aria-hidden />
      )}
      <span>
        {state.kind === "saving"
          ? "Kaydediliyor…"
          : (state.message ?? (state.kind === "success" ? "Kaydedildi." : "Hata oluştu."))}
      </span>
    </div>
  );
}

/** Ayarları PUT /api/admin/settings üzerinden kısmi olarak güncelleyen yardımcı. */
export async function saveSettings(
  update: AdminSettingsUpdateInput,
): Promise<{ ok: true; data: AdminSettingsView } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload !== null && typeof payload === "object" && "error" in payload && typeof (payload as { error: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `İstek başarısız (HTTP ${response.status}).`;
      return { ok: false, message };
    }
    return { ok: true, data: payload as AdminSettingsView };
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Ağ hatası.",
    };
  }
}

/** useSettingsSave — kaydetme durumu yönetimi için ortak hook. */
export function useSaveStatus() {
  const [state, setState] = useState<{
    kind: "idle" | "saving" | "success" | "error";
    message?: string;
  }>({ kind: "idle" });

  async function run(update: AdminSettingsUpdateInput): Promise<boolean> {
    setState({ kind: "saving" });
    const result = await saveSettings(update);
    if (result.ok) {
      setState({ kind: "success", message: "Kaydedildi." });
      window.setTimeout(() => setState({ kind: "idle" }), 2500);
      return true;
    }
    setState({ kind: "error", message: result.message });
    return false;
  }

  return { state, run, setState };
}
