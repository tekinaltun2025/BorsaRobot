import Link from "next/link";
import { Home, SearchX } from "lucide-react";

/**
 * Kök 404 sayfası (iyileştirme 8.4) — eşleşmeyen tüm yollar buraya düşer.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <SearchX className="h-12 w-12 text-gray-500" aria-hidden />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Sayfa bulunamadı</h1>
        <p className="max-w-md text-sm text-gray-400">
          Aradığınız sayfa taşınmış, kaldırılmış ya da hiç var olmamış
          olabilir. Adresi kontrol edip ana panele dönebilirsiniz.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Home className="h-4 w-4" aria-hidden />
          Ana Panele Dön
        </Link>
        <Link
          href="/yardim"
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
        >
          Yardım
        </Link>
      </div>
    </div>
  );
}
