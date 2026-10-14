import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionValue,
  isValidSession,
  isAuthEnabled,
  ADMIN_SESSION_COOKIE,
} from "@/lib/auth";

describe("auth — HMAC imzalı admin oturumu", () => {
  const ORIGINAL_PASSWORD = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password-123";
  });

  afterEach(() => {
    if (ORIGINAL_PASSWORD === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = ORIGINAL_PASSWORD;
    }
  });

  it("ADMIN_PASSWORD tanımlıysa auth etkindir", () => {
    expect(isAuthEnabled()).toBe(true);
  });

  it("ADMIN_PASSWORD boşsa auth devre dışıdır", () => {
    process.env.ADMIN_PASSWORD = "";
    expect(isAuthEnabled()).toBe(false);
  });

  it("ADMIN_PASSWORD yalnızca boşluk ise auth devre dışıdır", () => {
    process.env.ADMIN_PASSWORD = "   ";
    expect(isAuthEnabled()).toBe(false);
  });

  it("session değeri 64 hex karakterlik HMAC'tir", () => {
    const value = createSessionValue("test-password-123");
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aynı parola aynı imzayı üretir (deterministik)", () => {
    expect(createSessionValue("abc")).toBe(createSessionValue("abc"));
  });

  it("farklı parola farklı imza üretir", () => {
    expect(createSessionValue("abc")).not.toBe(createSessionValue("xyz"));
  });

  it("parola etrafındaki boşluklar kırpılır", () => {
    expect(createSessionValue("  abc  ")).toBe(createSessionValue("abc"));
  });

  it("geçerli oturum değeri doğrulanır", () => {
    expect(isValidSession(createSessionValue("test-password-123"))).toBe(true);
  });

  it("yanlış imza reddedilir", () => {
    expect(isValidSession("deadbeef".repeat(8))).toBe(false);
  });

  it("boş/eksik cookie reddedilir (koruma aktifken)", () => {
    expect(isValidSession(undefined)).toBe(false);
    expect(isValidSession("")).toBe(false);
  });

  it("koruma devre dışıyken her değer kabul edilir", () => {
    process.env.ADMIN_PASSWORD = "";
    expect(isValidSession(undefined)).toBe(true);
    expect(isValidSession("anything")).toBe(true);
  });

  it("parola değişince eski oturum geçersizleşir", () => {
    const oldSession = createSessionValue("old-password");
    process.env.ADMIN_PASSWORD = "new-password";
    expect(isValidSession(oldSession)).toBe(false);
    expect(isValidSession(createSessionValue("new-password"))).toBe(true);
  });

  it("cookie adı sabittir", () => {
    expect(ADMIN_SESSION_COOKIE).toBe("borsarobot_admin");
  });
});
