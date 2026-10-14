import { describe, it, expect } from "vitest";
import {
  stripCodeFences,
  extractJsonObject,
  parseAndValidate,
} from "@/server/services/llm-response-parser";
import { z } from "zod";

describe("llm-response-parser — stripCodeFences", () => {
  it("json fence'ini soyar", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("dilsiz fence'i soyar", () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("fence yoksa metni olduğu gibi döndürür", () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it("kapanışı olmayan açık fence'i temizler", () => {
    expect(stripCodeFences('```json\n{"a":1}')).toBe('{"a":1}');
  });
});

describe("llm-response-parser — extractJsonObject", () => {
  it("düz JSON döndürür", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("konuşma arasına gömülü JSON'u bulur", () => {
    const text = 'İşte analiz sonucunuz:\n{"confidence":0.8,"action":"BUY"}\nİyi yatırımlar.';
    expect(extractJsonObject(text)).toBe('{"confidence":0.8,"action":"BUY"}');
  });

  it("string içindeki parantezleri hesaba katar", () => {
    const text = '{"note":"parantez } içinde","x":1}';
    expect(extractJsonObject(text)).toBe('{"note":"parantez } içinde","x":1}');
  });

  it("iç içe objeleri dengeli çıkarır", () => {
    const text = 'prefix {"a":{"b":{"c":1}},"d":2} suffix';
    expect(extractJsonObject(text)).toBe('{"a":{"b":{"c":1}},"d":2}');
  });

  it("geçersiz JSON'da null döner", () => {
    expect(extractJsonObject("bu metinde json yok")).toBeNull();
  });

  it("kaçış karakterli string'leri doğru işler", () => {
    const text = '{"quote":"\\"escaped\\"","n":1}';
    expect(extractJsonObject(text)).toBe('{"quote":"\\"escaped\\"","n":1}');
  });
});

describe("llm-response-parser — parseAndValidate", () => {
  const schema = z.object({
    action: z.enum(["BUY", "SELL", "HOLD"]),
    confidence: z.number().min(0).max(1),
  });

  it("geçerli yanıtı doğrular", () => {
    const result = parseAndValidate(
      '```json\n{"action":"BUY","confidence":0.85}\n```',
      schema,
    );
    expect(result).toEqual({ action: "BUY", confidence: 0.85 });
  });

  it("JSON bulunamazsa LlmParseError fırlatır", () => {
    expect(() => parseAndValidate("yanıt yok", schema)).toThrow(
      /JSON bulunamadı/,
    );
  });

  it("şema dışı alanlar için LlmParseError fırlatır", () => {
    expect(() =>
      parseAndValidate('{"action":"MAYBE","confidence":0.5}', schema),
    ).toThrow();
  });

  it("confidence aralık dışıysa reddeder", () => {
    expect(() =>
      parseAndValidate('{"action":"BUY","confidence":1.5}', schema),
    ).toThrow();
  });
});
