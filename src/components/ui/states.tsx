import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ortak durum bileşenleri (iyileştirme 8.3) — admin/shared.tsx deseninin
 * uygulama geneline genelleştirilmiş hali. Server component uyumlu
 * (state/efekt yok), her sayfa ve client bileşeninde kullanılabilir.
 */

/** Sayfa/segment yükleme iskeleti — tek satır kart blokları. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-lg border border-gray-800 bg-gray-900/60",
        className,
      )}
    />
  );
}

/** Dashboard tarzı grid'ler için hazır kart iskeleti. */
export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28" />
      ))}
    </div>
  );
}

/** Hata durumu — sunucu/veri hatalarında tutarlı mesaj + isteğe bağlı eylem. */
export function ErrorState({
  title = "Bir hata oluştu",
  message,
  action,
  className,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/30 p-8 text-center",
        className,
      )}
    >
      <AlertCircle className="h-8 w-8 text-red-400" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-red-200">{title}</h2>
        {message ? (
          <p className="max-w-md text-sm text-red-300/80">{message}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Boş durum — veri olmadığında tutarlı mesaj + isteğe bağlı eylem. */
export function EmptyState({
  title = "Kayıt yok",
  message,
  action,
  className,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center",
        className,
      )}
    >
      <Inbox className="h-8 w-8 text-gray-500" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
        {message ? (
          <p className="max-w-md text-sm text-gray-400">{message}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
