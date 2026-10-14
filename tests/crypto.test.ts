import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/secret-crypto";

describe("crypto — AES-256-GCM secret şifreleme", () => {
  it("düz metni şifreler ve geri çözer", () => {
    const plain = "sk-test-1234567890abcdef";
    const encrypted = encryptSecret(plain);

    expect(encrypted).not.toBe(plain);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it("her şifrelemede farklı IV üretir (deterministik olmayan çıktı)", () => {
    const plain = "ayni-deger";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);

    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("boş girdi boş döner", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("enc: öneki olmayan eski kayıtları düz metin olarak döndürür (geriye dönük uyumluluk)", () => {
    const legacy = "eski-plain-key";
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it("bozuk şifreli değer için boş string döner (hata fırlatmaz)", () => {
    const corrupted = "enc:v1:bm90LXJlYWw=:bm90LXRhZw==:bm90LWRhdGE=";
    expect(decryptSecret(corrupted)).toBe("");
  });

  it("yanlış formatlı enc: değeri için boş string döner", () => {
    expect(decryptSecret("enc:v1:sadece-iv")).toBe("");
  });

  it("uzun API anahtarlarını doğru şifreler/çözer", () => {
    const longKey = "AIza" + "x".repeat(200);
    expect(decryptSecret(encryptSecret(longKey))).toBe(longKey);
  });

  it("özel karakterler ve unicode içeren değerleri korur", () => {
    const tricky = "şifre-ğüş-öç-🔑-<script>&\"'";
    expect(decryptSecret(encryptSecret(tricky))).toBe(tricky);
  });
});
