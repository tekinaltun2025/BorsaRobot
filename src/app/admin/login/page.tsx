"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Loader2 } from "lucide-react";

/**
 * Yönetici giriş sayfası — /admin/login.
 *
 * ADMIN_PASSWORD ile oturum açar; başarılı girişte `next` parametresindeki
 * adrese (varsayılan /admin) yönlendirir. Hata mesajları parola doğruluğu
 * hakkında ipucu vermez.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data: { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Giriş başarısız.");
        return;
      }
      const next = searchParams.get("next") ?? "/admin";
      router.replace(next.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch {
      setError("Giriş isteği başarısız oldu. Bağlantınızı kontrol edin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600/15">
        <Lock className="h-7 w-7 text-blue-400" aria-hidden />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-bold">Yönetim Paneli Girişi</h1>
        <p className="mt-1 text-sm text-gray-400">
          Devam etmek için yönetici parolasını girin.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div>
          <label
            htmlFor="admin-password"
            className="mb-1.5 block text-sm font-medium text-gray-300"
          >
            Yönetici Parolası
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
        </button>
      </form>

      <p className="text-center text-xs text-gray-500">
        Parola sunucuda <code className="text-gray-400">ADMIN_PASSWORD</code> ortam
        değişkeniyle tanımlanır.
      </p>
    </div>
  );
}
