import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getBankClient } from "@/server/providers/provider-factory";
import { DenizBankClientError } from "@/server/providers/denizbank/denizbank-base-client";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/test-denizbank
 * DenizBank API Market bağlantısını test eder — GetAccountList çağrısı ile
 * banka erişilebilirliğini ve AppKey geçerliliğini doğrular (admin paneli
 * "Bağlantıyı Test Et" düğmesi).
 *
 * Mock modda (DENIZBANK_MOCK=true veya AppKey boş) test deterministik mock
 * transport üzerinden koşar — gerçek bankaya istek ATILMAZ; yanıt bu durumu
 * açıkça belirtir.
 *
 * Hata sözleşmesi:
 *  - 200: { ok, mockMode, message, accountCount? } — bağlantı testi çalıştı
 *    ve sonucunu ölçtü (başarısızsa da ok=false ile 200).
 *  - 500: test kendisi beklenmedik hata verdi.
 */
export async function POST(_request: NextRequest) {
  try {
    const client = getBankClient();
    const accountList = await client.getAccountList();
    const accounts = accountList.AccountList ?? [];

    return NextResponse.json({
      ok: true,
      mockMode: client.isMockMode,
      message: client.isMockMode
        ? `Mock mod: bağlantı testi deterministik mock transport ile başarılı ` +
          `(${accounts.length} hesap döndü). Gerçek banka çağrısı yapılmadı.`
        : `Banka bağlantısı başarılı: ${accounts.length} hesap okundu.`,
      accountCount: accounts.length,
    });
  } catch (error: unknown) {
    const client = getBankClient();
    if (error instanceof DenizBankClientError) {
      return NextResponse.json({
        ok: false,
        mockMode: client.isMockMode,
        message:
          `Banka bağlantı testi başarısız (${error.errorClass}` +
          (error.bankErrorCode ? `: ${error.bankErrorCode}` : "") +
          `): ${error.message}`,
      });
    }
    console.error("[admin/test-denizbank POST] Hata:", error);
    return NextResponse.json(
      {
        ok: false,
        mockMode: client.isMockMode,
        message: "Bağlantı testi sırasında beklenmeyen bir hata oluştu.",
      },
      { status: 500 },
    );
  }
}
