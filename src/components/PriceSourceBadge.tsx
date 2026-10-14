import { Database, ShieldAlert, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PriceSourceStatus } from "@/lib/types";

/**
 * Fiyat kaynağı rozeti — izleme listesi ve hisse detay sayfalarında ortak.
 *
 * Durumlar:
 *  - effective=YAHOO  → yeşil "Gerçek Veri (Yahoo Finance)".
 *  - effective=SIMULATED (seçili) → amber "Simüle Veri".
 *  - effective=SIMULATED (fallback) → amber "Simüle Veri" + tooltip'te
 *    fallback nedeni (Yahoo hata mesajı).
 *
 * Saf bileşendir — server ve client component'lerde kullanılabilir.
 */
export function PriceSourceBadge({ source }: { source: PriceSourceStatus }) {
  const isReal = source.effective === "YAHOO";
  const tooltip =
    source.fallbackUsed && source.fallbackReason
      ? `Yahoo Finance başarısız, simüle veriye düşüldü: ${source.fallbackReason}`
      : undefined;

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex cursor-help items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        isReal
          ? "border-emerald-800 bg-emerald-950 text-emerald-300"
          : "border-amber-800 bg-amber-950 text-amber-300",
      )}
    >
      {isReal ? (
        <Wifi className="h-3 w-3" aria-hidden />
      ) : source.fallbackUsed ? (
        <ShieldAlert className="h-3 w-3" aria-hidden />
      ) : (
        <Database className="h-3 w-3" aria-hidden />
      )}
      {isReal ? "Gerçek Veri (Yahoo Finance)" : "Simüle Veri"}
    </span>
  );
}
