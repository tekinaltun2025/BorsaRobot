import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * AdminSettings API anahtarı şifrelemesi — AES-256-GCM.
 *
 * Tasarım (iyileştirme 1.4):
 *  - Master key: `SETTINGS_ENCRYPTION_KEY` env değişkeni. Verilmezse
 *    `DATABASE_URL`'den türetilir (geliştirme kolaylığı; üretimde açıkça
 *    tanımlanmalıdır — .env.example'da belgelenmiştir).
 *  - Format: `enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>` — sürüm önekli;
 *    ileride algoritma değişirse eski kayıtlar ayrıştırılabilir.
 *  - Değer `enc:` önekiyle başlamıyorsa düz metin kabul edilir (geriye dönük
 *    uyumluluk: mevcut DB'deki eski anahtarlar okunmaya devam eder).
 *  - Şifreleme başarısızsa hata yutulmaz — çağıran karar verir (log + düz
 *    değer yazmak yerine hata fırlatmak güvenli taraftadır).
 */

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1";

/** Master key'i 32 byte'a indirger (SHA-256). */
function masterKey(): Buffer {
  const secret =
    process.env.SETTINGS_ENCRYPTION_KEY?.trim() ||
    process.env.DATABASE_URL ||
    "borsarobot-dev-fallback-key";
  return createHash("sha256").update(secret).digest();
}

/** Değer şifreli mi? (`enc:v1:` öneki kontrolü) */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

/**
 * Düz metni şifreler. Boş girdi boş döner (DB'de boş anahtar = tanımsız).
 */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Şifreli değeri çözer. Düz metinse (eski kayıt) olduğu gibi döner.
 * Bozuk şifreli değer → boş string (anahtar rotasyonu sonrası güvenli davranış;
 * kullanıcı admin panelinden yeniden girer).
 */
export function decryptSecret(value: string): string {
  if (!value) return "";
  if (!isEncrypted(value)) return value;
  try {
    const parts = value.split(":");
    if (parts.length !== 5) return "";
    const ivB64 = parts[2]!;
    const tagB64 = parts[3]!;
    const dataB64 = parts[4]!;
    const decipher = createDecipheriv(
      ALGORITHM,
      masterKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // Anahtar değişti veya veri bozuk — sır okunamaz; boş döner.
    return "";
  }
}
