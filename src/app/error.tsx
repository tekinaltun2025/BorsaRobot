"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { ErrorState } from "@/components/ui/states";

/**
 * Kök hata sınırı (iyileştirme 8.4) — App Router segment hata dosyası.
 * Bir sayfanın sunucu/client render'ı patlarsa Next.js çıplak 500 yerine
 * bu bileşeni gösterir. reset() segment'i yeniden render eder.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest üretimde hata izlemede kullanılır; geliştirmede tam mesaj görünür.
    console.error("[RootError] Yakalanmayan sayfa hatası:", error);
  }, [error]);

  return (
    <ErrorState
      title="Sayfa yüklenemedi"
      message={
        error.digest
          ? `Sunucu hatası (kod: ${error.digest}). Lütfen tekrar deneyin.`
          : "Beklenmeyen bir sunucu hatası oluştu. Lütfen tekrar deneyin."
      }
      action={
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Tekrar Dene
        </button>
      }
      className="mt-8"
    />
  );
}
