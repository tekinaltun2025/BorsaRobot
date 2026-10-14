import type { ReactNode } from "react";
import { isAuthenticated } from "@/lib/auth";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

/**
 * /admin segment layout'u — sunucu tarafında oturum doğrulaması yapar.
 *
 * Middleware ilk savunmadır; bu layout ikinci savunma katmanıdır (defense in
 * depth): middleware atlanırsa (örn. doğrudan RSC erişimi) oturumsuz istek
 * yine de engellenir.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const authed = await isAuthenticated();

  return (
    <div className="space-y-4">
      {authed && (
        <div className="flex justify-end">
          <AdminLogoutButton />
        </div>
      )}
      {children}
    </div>
  );
}
