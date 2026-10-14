import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adminSettingsUpdateSchema } from "@/lib/validators/admin-settings";
import {
  getOrCreateAdminSettings,
  toAdminSettingsView,
} from "@/server/services/settings-service";
import { guardRequest } from "@/lib/api-guard";
import { buildAdminSettingsUpdateData } from "@/server/services/settings-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settings
 * Mevcut admin ayarlarını (API anahtarları MASKELİ) döndürür.
 */
export async function GET(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  try {
    const settings = await getOrCreateAdminSettings();
    return NextResponse.json(toAdminSettingsView(settings));
  } catch (error: unknown) {
    console.error("[admin/settings GET] Hata:", error);
    return NextResponse.json(
      { error: "Ayarlar yüklenemedi." },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/admin/settings
 * Zod ile doğrulanmış kısmi güncelleme uygular.
 *
 * Kurallar:
 *  - Yalnızca gönderilen alanlar güncellenir.
 *  - API anahtarı boş string ise temizlenir; undefined ise korunur.
 *  - LIVE moda geçişte, bekleyen (PENDING/PENDING_RECONCILIATION/EXECUTING)
 *    emir varsa geçiş REDDEDİLİR (Bölüm 3.3 adım 3 — veri tutarlılığı).
 *  - LIVE moda geçişte liveModeConfirmedAt damgası basılır (adım 5).
 */
export async function PUT(request: NextRequest) {
  const guard = guardRequest(request, "api-general");
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Geçersiz JSON gövdesi." },
      { status: 400 },
    );
  }

  const parsed = adminSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Doğrulama hatası.",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const update = parsed.data;

  try {
    // LIVE moda geçiş guard'ı: nihai olmayan durumda emir varsa reddet.
    if (update.tradingMode === "LIVE") {
      const activeOrders = await prisma.order.count({
        where: {
          status: { in: ["PENDING", "EXECUTING", "PENDING_RECONCILIATION"] },
        },
      });
      if (activeOrders > 0) {
        return NextResponse.json(
          {
            error: `Canlı moda geçiş reddedildi: ${activeOrders} adet nihai durumda olmayan emir var. Tüm emirler tamamlanmadan geçiş yapılamaz.`,
          },
          { status: 409 },
        );
      }
    }

    // Alan listesi temelli kısmi güncelleme (iyileştirme 4.4): doğrudan
    // kopyalanan alanlar + anahtar şifreleme + özel dönüşümler tek yerde.
    const data = buildAdminSettingsUpdateData(update);

    const updated = await prisma.adminSettings.update({
      where: { id: "singleton" },
      data,
    });

    return NextResponse.json(toAdminSettingsView(updated));
  } catch (error: unknown) {
    // Kayıt yoksa oluştur ve tekrar dene (ilk kurulum yarış durumu).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      await getOrCreateAdminSettings();
      try {
        const retry = await prisma.adminSettings.update({
          where: { id: "singleton" },
          data: update as Prisma.AdminSettingsUpdateInput,
        });
        return NextResponse.json(toAdminSettingsView(retry));
      } catch (retryError: unknown) {
        console.error("[admin/settings PUT] Retry hatası:", retryError);
        return NextResponse.json(
          { error: "Ayarlar güncellenemedi." },
          { status: 500 },
        );
      }
    }
    console.error("[admin/settings PUT] Hata:", error);
    return NextResponse.json(
      { error: "Ayarlar güncellenemedi." },
      { status: 500 },
    );
  }
}
