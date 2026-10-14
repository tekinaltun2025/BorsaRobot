import type { AiProvider } from "@/lib/types";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-crypto";
import type { ILlmProvider } from "@/server/providers/llm-provider";
import { LlmConfigError } from "@/server/providers/llm-provider";
import { GeminiLlmProvider } from "@/server/providers/gemini-provider";
import { OpenAiLlmProvider } from "@/server/providers/openai-provider";
import { AnthropicLlmProvider } from "@/server/providers/anthropic-provider";
import { OpenAiCompatibleLlmProvider } from "@/server/providers/openai-compatible-provider";
import { DEFAULT_BASE_URLS } from "@/lib/constants";
import { logApiCall } from "@/server/services/api-log-service";

/**
 * LLM sağlayıcı fabrikası — AdminSettings.aiProvider'a göre doğru provider'ı
 * üretir (Bölüm 4.5 resolveLlmProvider sözleşmesi).
 *
 * Kurallar:
 *  - Her çözümlemede AdminSettings'ten TAZE okunur; admin sağlayıcı/model/key
 *    değiştirdiğinde bir sonraki çağrı anında yeni yapılandırmayı kullanır.
 *  - API key yoksa anlamlı TR hata fırlatılır (LlmConfigError → HTTP 400).
 *  - CUSTOM (local AI) için customBaseUrl zorunludur; yoksa anlamlı TR hata.
 *  - Provider stateless'tir; tüm kalıcı veri DB'dedir.
 */

/** AdminSettings'ten LLM yapılandırmasının okunmuş hali. */
export interface LlmProviderConfig {
  aiProvider: AiProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  deepseekApiKey: string;
  grokApiKey: string;
  mistralApiKey: string;
  nvidiaApiKey: string;
  /** Local/custom OpenAI-uyumlu base URL (CUSTOM için zorunlu). */
  customBaseUrl: string;
  /** Local/custom API key — local AI'larda genellikle boş. */
  customApiKey: string;
  /** Local/custom model adı (serbest metin). */
  customModel: string;
  geminiModel: string;
  openaiModel: string;
  anthropicModel: string;
  deepseekModel: string;
  grokModel: string;
  mistralModel: string;
  nvidiaModel: string;
}

/**
 * AdminSettings'ten LLM yapılandırmasını okur.
 * Ayar kaydı yoksa env değişkenlerinden (GEMINI_API_KEY / OPENAI_API_KEY /
 * ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / GROK_API_KEY / MISTRAL_API_KEY /
 * NVIDIA_API_KEY / CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL) yedek
 * okuma yapılır; hiçbiri yoksa boş string döner (factory hata fırlatır).
 */
export async function getLlmProviderConfig(): Promise<LlmProviderConfig> {
  const settings = await prisma.adminSettings.findUnique({
    where: { id: "singleton" },
    select: {
      aiProvider: true,
      geminiApiKey: true,
      openaiApiKey: true,
      anthropicApiKey: true,
      deepseekApiKey: true,
      grokApiKey: true,
      mistralApiKey: true,
      nvidiaApiKey: true,
      customBaseUrl: true,
      customApiKey: true,
      customModel: true,
      geminiModel: true,
      openaiModel: true,
      anthropicModel: true,
      deepseekModel: true,
      grokModel: true,
      mistralModel: true,
      nvidiaModel: true,
    },
  });

  return {
    aiProvider: (settings?.aiProvider as AiProvider | null) ?? "GEMINI",
    // DB'deki anahtarlar şifreli saklanır; provider'a verilmeden önce çözülür.
    geminiApiKey: decryptSecret(settings?.geminiApiKey || "") || process.env.GEMINI_API_KEY || "",
    openaiApiKey: decryptSecret(settings?.openaiApiKey || "") || process.env.OPENAI_API_KEY || "",
    anthropicApiKey: decryptSecret(settings?.anthropicApiKey || "") || process.env.ANTHROPIC_API_KEY || "",
    deepseekApiKey: decryptSecret(settings?.deepseekApiKey || "") || process.env.DEEPSEEK_API_KEY || "",
    grokApiKey: decryptSecret(settings?.grokApiKey || "") || process.env.GROK_API_KEY || "",
    mistralApiKey: decryptSecret(settings?.mistralApiKey || "") || process.env.MISTRAL_API_KEY || "",
    nvidiaApiKey: decryptSecret(settings?.nvidiaApiKey || "") || process.env.NVIDIA_API_KEY || "",
    customBaseUrl: settings?.customBaseUrl || process.env.CUSTOM_BASE_URL || "",
    customApiKey: decryptSecret(settings?.customApiKey || "") || process.env.CUSTOM_API_KEY || "",
    customModel: settings?.customModel || process.env.CUSTOM_MODEL || "",
    geminiModel: settings?.geminiModel || "gemini-2.0-flash",
    openaiModel: settings?.openaiModel || "gpt-4o",
    anthropicModel: settings?.anthropicModel || "claude-sonnet-4-5",
    deepseekModel: settings?.deepseekModel || "deepseek-chat",
    grokModel: settings?.grokModel || "grok-4",
    mistralModel: settings?.mistralModel || "mistral-small-latest",
    nvidiaModel: settings?.nvidiaModel || "moonshotai/kimi-k3",
  };
}

/**
 * Verilen yapılandırmaya göre ILlmProvider örneği üretir.
 *
 * API key yoksa veya CUSTOM'da base URL eksikse LlmConfigError fırlatır —
 * mesaj kullanıcıyı admin paneline yönlendirir. Bu hata API katmanında
 * 400'e map edilir.
 */
export function createLlmProvider(config: LlmProviderConfig): ILlmProvider {
  switch (config.aiProvider) {
    case "GEMINI": {
      if (!config.geminiApiKey.trim()) {
        throw new LlmConfigError(
          "Gemini API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new GeminiLlmProvider(config.geminiApiKey, config.geminiModel, logApiCall);
    }
    case "OPENAI": {
      if (!config.openaiApiKey.trim()) {
        throw new LlmConfigError(
          "OpenAI API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new OpenAiLlmProvider(config.openaiApiKey, config.openaiModel, logApiCall);
    }
    case "ANTHROPIC": {
      if (!config.anthropicApiKey.trim()) {
        throw new LlmConfigError(
          "Anthropic API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new AnthropicLlmProvider(config.anthropicApiKey, config.anthropicModel, logApiCall);
    }
    case "DEEPSEEK": {
      if (!config.deepseekApiKey.trim()) {
        throw new LlmConfigError(
          "DeepSeek API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new OpenAiCompatibleLlmProvider({
        providerId: "DEEPSEEK",
        baseUrl: DEFAULT_BASE_URLS.DEEPSEEK,
        apiKey: config.deepseekApiKey,
        model: config.deepseekModel,
        logApiCall,
      });
    }
    case "GROK": {
      if (!config.grokApiKey.trim()) {
        throw new LlmConfigError(
          "Grok (xAI) API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new OpenAiCompatibleLlmProvider({
        providerId: "GROK",
        baseUrl: DEFAULT_BASE_URLS.GROK,
        apiKey: config.grokApiKey,
        model: config.grokModel,
        logApiCall,
      });
    }
    case "MISTRAL": {
      if (!config.mistralApiKey.trim()) {
        throw new LlmConfigError(
          "Mistral API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      return new OpenAiCompatibleLlmProvider({
        providerId: "MISTRAL",
        baseUrl: DEFAULT_BASE_URLS.MISTRAL,
        apiKey: config.mistralApiKey,
        model: config.mistralModel,
        logApiCall,
      });
    }
    case "NVIDIA": {
      if (!config.nvidiaApiKey.trim()) {
        throw new LlmConfigError(
          "NVIDIA API key tanımlı değil. Admin panelinden (AI Ayarları) ekleyin veya .env dosyasına NVIDIA_API_KEY yazın.",
        );
      }
      return new OpenAiCompatibleLlmProvider({
        providerId: "NVIDIA",
        baseUrl: DEFAULT_BASE_URLS.NVIDIA,
        apiKey: config.nvidiaApiKey,
        model: config.nvidiaModel,
        // NVIDIA NIM'e özgü: en derin akıl yürütme seviyesi.
        reasoningEffort: "max",
        logApiCall,
      });
    }
    case "CUSTOM": {
      if (!config.customBaseUrl.trim()) {
        throw new LlmConfigError(
          "Local AI için Base URL girin (örn. http://localhost:11434/v1 Ollama veya http://localhost:1234/v1 LM Studio). Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      if (!config.customModel.trim()) {
        throw new LlmConfigError(
          "Local AI için model adı girin (örn. llama3.2, qwen2.5). Admin panelinden (AI Ayarları) ekleyin.",
        );
      }
      // API key opsiyonel — Ollama gibi local sunucular key istemez.
      return new OpenAiCompatibleLlmProvider({
        providerId: "CUSTOM",
        baseUrl: config.customBaseUrl,
        apiKey: config.customApiKey,
        model: config.customModel,
        logApiCall,
      });
    }
    default: {
      // Exhaustiveness guard — AiProvider union'ı genişlediğinde derleyici uyarır.
      const exhaustive: never = config.aiProvider;
      throw new LlmConfigError(`Bilinmeyen AI sağlayıcı: ${String(exhaustive)}`);
    }
  }
}

/**
 * AdminSettings.aiProvider'a göre provider döndüren kısayol —
 * servis katmanının kullandığı ana giriş noktası.
 */
export async function resolveLlmProvider(): Promise<ILlmProvider> {
  const config = await getLlmProviderConfig();
  return createLlmProvider(config);
}
