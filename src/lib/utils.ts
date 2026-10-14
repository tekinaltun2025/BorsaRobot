import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Koşullu sınıf adlarını birleştirir ve Tailwind sınıf çakışmalarını
 * son kazanan olacak şekilde çözer.
 *
 * @example cn("p-2", isActive && "bg-blue-500", "p-4") // → "bg-blue-500 p-4"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * API anahtarını maskeli biçimde döndürür — yalnızca son 4 karakter görünür.
 * Boş/null değerler için boş string döner (client'a hiçbir sır sızmaz).
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 4) return `••••${trimmed}`;
  return `••••••••${trimmed.slice(-4)}`;
}

/**
 * Parasal değerleri Türkçe yerel ayarlarıyla biçimlendirir.
 * Number tipi para HESABI için kullanılmaz (ADR-8) — yalnızca gösterim.
 */
export function formatCurrency(value: number, currency: string = "TRY"): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Tarihleri Türkçe yerel ayarlarıyla kısa biçimde gösterir.
 */
export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
