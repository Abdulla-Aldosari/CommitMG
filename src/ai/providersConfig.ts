// Single source of truth for AI provider metadata used by both the settings
// webview (provider dropdown, model dropdown, API key help links, rate-limit
// links) and the AI client factory (default model fallback, rate-limit
// support flag, live model filtering). This file is vscode-free and
// network-free: pure data plus small lookup helpers.
//
// Each provider carries its full filtering metadata (modelIdExcludeKeywords,
// modelIdExcludeExact, rateLimitsUrl), and filterProviderModels() applies
// the centralized filtering pipeline to every live model list.

import type { ModelListEntry } from "./aiClient";

export interface ModelConfig {
  modelId: string;
  modelLabel: string;
  free: boolean;
}

// The eight fixed direct-API providers. "custom" is a ninth, synthetic entry
// (see CUSTOM_PROVIDER_CONFIG below) for user-supplied OpenAI-compatible
// endpoints (e.g. a local Ollama server); it is not part of this union
// because it carries no fixed models/apiKeyUrl/steps.
export type FixedProviderName = "gemini" | "openai" | "anthropic" | "deepseek" | "groq" | "mistral" | "cohere" | "stepfun";

// Every provider selectable in the "Direct API" group of the settings
// dropdown, including the synthetic "custom" entry.
export type DirectProviderName = FixedProviderName | "custom";

export interface ProviderConfig {
  name: FixedProviderName;
  serviceName: string;
  providerName: string;
  defaultModelId: string;
  displayLabel: string;
  // Substrings that make a live model unusable for commit-message
  // generation (TTS, embeddings, vision, etc.). Applied centrally by
  // filterProviderModels().
  modelIdExcludeKeywords: readonly string[];
  // Exact model IDs to drop: aliases that share a name pattern and cannot
  // be caught by keyword or date-suffix rules. Only present where needed.
  modelIdExcludeExact?: readonly string[];
  models: readonly ModelConfig[];
  apiKeyUrl: string;
  apiKeyUrlLabel: string;
  steps: readonly string[];
  hasApiRateLimits: boolean;
  // The provider's own rate-limit page, linked from the settings webview
  // when hasApiRateLimits is false and the user clicks Check Rate Limits.
  rateLimitsUrl: string;
}

export const AI_PROVIDERS: Readonly<Record<FixedProviderName, ProviderConfig>> = {
  gemini: {
    name: "gemini",
    serviceName: "Google Gemini",
    providerName: "Google",
    defaultModelId: "gemini-flash-latest",
    displayLabel: "Google Gemini",
    modelIdExcludeKeywords: ["tts", "image", "lyria", "robotics", "embedding", "aqa", "computer-use", "live", "translate", "research", "veo", "antigravity", "nano-banana"],
    models: [
      { modelId: "gemini-flash-latest", modelLabel: "Gemini Flash (Latest)", free: true },
      { modelId: "gemini-3.5-flash", modelLabel: "Gemini 3.5 Flash", free: true },
      { modelId: "gemini-3.1-flash-lite", modelLabel: "Gemini 3.1 Flash-Lite", free: true },
      { modelId: "gemini-2.5-flash", modelLabel: "Gemini 2.5 Flash", free: true },
      { modelId: "gemini-2.5-flash-lite", modelLabel: "Gemini 2.5 Flash-Lite", free: true },
      { modelId: "gemini-2.5-pro", modelLabel: "Gemini 2.5 Pro", free: false },
    ],
    apiKeyUrl: "https://aistudio.google.com/api-keys",
    apiKeyUrlLabel: "Google AI Studio",
    steps: [
      "Go to Google AI Studio: <code>https://aistudio.google.com/</code>",
      "Sign in with your Google account.",
      "Click <code>Get API key</code> in the left sidebar.",
      "Click <code>Create API key</code>.",
      "Name your key and choose an imported project (or create a new one).",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://aistudio.google.com/usage",
  },

  openai: {
    name: "openai",
    serviceName: "OpenAI ChatGPT",
    providerName: "OpenAI",
    defaultModelId: "gpt-4o-mini",
    displayLabel: "OpenAI ChatGPT",
    modelIdExcludeKeywords: [
      "whisper",
      "tts",
      "dall-e",
      "image",
      "embedding",
      "moderation",
      "transcribe",
      "audio",
      "realtime",
      "sora",
      "instruct",
      "search",
      "codex",
      "davinci",
      "babbage",
    ],
    modelIdExcludeExact: [
      "chat-latest", // generic alias with no version info, not useful for model selection
    ],
    models: [
      { modelId: "gpt-4o-mini", modelLabel: "GPT-4o Mini", free: false },
      { modelId: "gpt-4o", modelLabel: "GPT-4o", free: false },
      { modelId: "gpt-4.1-mini", modelLabel: "GPT-4.1 Mini", free: false },
      { modelId: "gpt-4.1", modelLabel: "GPT-4.1", free: false },
    ],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyUrlLabel: "OpenAI Platform",
    steps: [
      "Go to OpenAI Platform: <code>https://platform.openai.com/</code>",
      "Sign in or create an OpenAI account.",
      "Navigate to <code>API keys</code> in the left sidebar.",
      "Click <code>Create new secret key</code> and give it a name.",
      "Copy the key immediately - it will only be shown once.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://platform.openai.com/settings/organization/limits",
  },

  anthropic: {
    name: "anthropic",
    serviceName: "Anthropic Claude",
    providerName: "Anthropic",
    defaultModelId: "claude-3-5-haiku-latest",
    displayLabel: "Anthropic Claude",
    modelIdExcludeKeywords: [],
    models: [
      { modelId: "claude-3-5-haiku-latest", modelLabel: "Claude 3.5 Haiku", free: false },
      { modelId: "claude-3-5-sonnet-latest", modelLabel: "Claude 3.5 Sonnet", free: false },
      { modelId: "claude-sonnet-4-6", modelLabel: "Claude Sonnet 4.6", free: false },
      { modelId: "claude-opus-4-5-20251101", modelLabel: "Claude Opus 4.5", free: false },
    ],
    apiKeyUrl: "https://platform.claude.com/settings/workspaces/default/keys",
    apiKeyUrlLabel: "Claude Console",
    steps: [
      "Go to Claude Console: <code>https://platform.claude.com</code>",
      "Sign in or create a Claude account.",
      'Click <code>API Keys</code> in the left sidebar under the "Manage" category.',
      "Click <code>Create Key</code> and give it a descriptive name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://platform.claude.com/settings/limits",
  },

  deepseek: {
    name: "deepseek",
    serviceName: "DeepSeek",
    providerName: "DeepSeek",
    defaultModelId: "deepseek-chat",
    displayLabel: "DeepSeek",
    modelIdExcludeKeywords: [],
    models: [
      { modelId: "deepseek-v4-flash", modelLabel: "DeepSeek V4 Flash", free: true },
      { modelId: "deepseek-chat", modelLabel: "DeepSeek Chat", free: true },
      { modelId: "deepseek-reasoner", modelLabel: "DeepSeek Reasoner", free: false },
      { modelId: "deepseek-v4-pro", modelLabel: "DeepSeek V4 Pro", free: false },
    ],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    apiKeyUrlLabel: "DeepSeek Platform",
    steps: [
      "Go to DeepSeek Platform: <code>https://platform.deepseek.com/</code>",
      "Sign in or create a DeepSeek account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create new API key</code> and give it a name.",
      "Copy the key - it will only be shown once.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://platform.deepseek.com/usage",
  },

  groq: {
    name: "groq",
    serviceName: "Groq",
    providerName: "Groq",
    defaultModelId: "llama-3.3-70b-versatile",
    displayLabel: "Groq",
    modelIdExcludeKeywords: ["whisper", "orpheus", "prompt-guard", "safeguard"],
    models: [
      { modelId: "llama-3.3-70b-versatile", modelLabel: "Llama 3.3 70B Versatile", free: true },
      { modelId: "llama-3.1-8b-instant", modelLabel: "Llama 3.1 8B Instant", free: true },
      { modelId: "meta-llama/llama-4-scout-17b-16e-instruct", modelLabel: "Llama 4 Scout 17B", free: true },
      { modelId: "qwen/qwen3-32b", modelLabel: "Qwen3 32B", free: true },
    ],
    apiKeyUrl: "https://console.groq.com/keys",
    apiKeyUrlLabel: "Groq Console",
    steps: [
      "Go to Groq Console: <code>https://console.groq.com/</code>",
      "Sign in or create a Groq account (free).",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create API Key</code> and give it a name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://console.groq.com/settings/limits",
  },

  mistral: {
    name: "mistral",
    serviceName: "Mistral AI",
    providerName: "Mistral",
    defaultModelId: "mistral-small-latest",
    displayLabel: "Mistral AI",
    modelIdExcludeKeywords: ["voxtral", "embed", "moderation", "ocr", "fim"],
    modelIdExcludeExact: [
      "mistral-medium-3.5", // dot-variant alias of mistral-medium-3-5
      "mistral-medium-3", // older version, superseded by mistral-medium-3-5
      "mistral-code-latest", // alias of codestral-latest
      "mistral-medium", // bare alias, less explicit than mistral-medium-latest
    ],
    models: [
      { modelId: "mistral-small-latest", modelLabel: "Mistral Small (Latest)", free: true },
      { modelId: "mistral-large-latest", modelLabel: "Mistral Large (Latest)", free: false },
      { modelId: "mistral-vibe-cli-fast", modelLabel: "Mistral Vibe CLI Fast", free: true },
      { modelId: "codestral-latest", modelLabel: "Codestral (Latest)", free: true },
      { modelId: "mistral-medium-latest", modelLabel: "Mistral Medium (Latest)", free: false },
    ],
    apiKeyUrl: "https://console.mistral.ai/api-keys/",
    apiKeyUrlLabel: "Mistral Console",
    steps: [
      "Go to Mistral Console: <code>https://console.mistral.ai/</code>",
      "Sign in or create a Mistral account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create new key</code> and give it a name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: true,
    rateLimitsUrl: "https://console.mistral.ai/usage",
  },
  cohere: {
    name: "cohere",
    serviceName: "Cohere",
    providerName: "Cohere",
    defaultModelId: "command-r7b-12-2024",
    displayLabel: "Cohere",
    modelIdExcludeKeywords: ["embed", "rerank", "transcribe", "vision", "translate"],
    models: [
      { modelId: "command-r7b-12-2024", modelLabel: "Command R7B (Dec 2024)", free: true },
      { modelId: "command-r-plus-08-2024", modelLabel: "Command R+ (Aug 2024)", free: false },
      { modelId: "command-r-08-2024", modelLabel: "Command R (Aug 2024)", free: false },
      { modelId: "command-a-03-2025", modelLabel: "Command A (Mar 2025)", free: false },
    ],
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    apiKeyUrlLabel: "Cohere Dashboard",
    steps: [
      "Go to Cohere Dashboard: <code>https://dashboard.cohere.com/</code>",
      "Sign in or create a Cohere account (free trial available).",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>New Trial Key</code> or <code>New Production Key</code>.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://dashboard.cohere.com/billing",
  },

  stepfun: {
    name: "stepfun",
    serviceName: "StepFun",
    providerName: "StepFun",
    defaultModelId: "step-3.5-flash",
    displayLabel: "StepFun",
    modelIdExcludeKeywords: ["tts", "audio", "asr", "image"],
    models: [
      { modelId: "step-3.5-flash", modelLabel: "Step 3.5 Flash", free: true },
      { modelId: "step-3.7-flash", modelLabel: "Step 3.7 Flash", free: false },
    ],
    apiKeyUrl: "https://platform.stepfun.ai/interface-key",
    apiKeyUrlLabel: "StepFun Platform",
    steps: [
      "Go to StepFun Platform: <code>https://platform.stepfun.ai/account-info</code>",
      "Sign in or create a StepFun account.",
      "Navigate to <code>API Keys</code> in the left sidebar.",
      "Click <code>Create API Key</code> and give the key a name.",
      "Copy the generated API key.",
      "Paste it in the API Key field and click Save.",
    ],
    hasApiRateLimits: false,
    rateLimitsUrl: "https://platform.stepfun.ai/account-info",
  },
};

// The base URL each OpenAI-compatible fixed provider talks to. "custom" is
// deliberately absent: its base URL always comes from user input.
export const OPENAI_COMPATIBLE_BASE_URLS: Readonly<Partial<Record<FixedProviderName, string>>> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  stepfun: "https://api.stepfun.ai/v1",
};

// Returns the config for a fixed provider, or undefined when the name is not
// one of the eight fixed providers (e.g. "custom").
export function getProviderConfig(providerName: string): ProviderConfig | undefined {
  return (AI_PROVIDERS as Record<string, ProviderConfig>)[providerName];
}

// Returns the model id a fixed provider should use when none was chosen:
// the configured default, falling back to the first static model. The
// gateway resolves empty model ids through this single helper, so every
// caller picks the same fallback.
export function getDefaultModelId(providerName: FixedProviderName): string {
  const provider = AI_PROVIDERS[providerName];
  return provider.defaultModelId || provider.models[0]?.modelId || "";
}

// Returns an ordered array of the eight fixed provider configs, for building
// the settings dropdown's "Direct API" group.
export function getProvidersArray(): readonly ProviderConfig[] {
  return Object.values(AI_PROVIDERS);
}

// Applies the centralized model-filtering pipeline to a provider's raw live
// model list. Provider files only ever return the raw API response; every
// filtering rule lives here so all callers filter identically.
export function filterProviderModels(providerName: FixedProviderName, raw: readonly ModelListEntry[]): ModelListEntry[] {
  const config = AI_PROVIDERS[providerName];
  const excludeKeywords = config.modelIdExcludeKeywords;

  // Step 0: remove models whose ID contains any excluded keyword.
  let models =
    excludeKeywords.length > 0
      ? raw.filter((m) => {
          const id = m.modelId.toLowerCase();
          return !excludeKeywords.some((kw) => id.includes(kw));
        })
      : [...raw];

  // Step 1: remove exact duplicate IDs.
  const seen = new Set<string>();
  models = models.filter((m) => {
    if (seen.has(m.modelId)) return false;
    seen.add(m.modelId);
    return true;
  });

  // Step 2: remove specific model IDs listed in modelIdExcludeExact.
  // Used for aliases that share the same name pattern (e.g.
  // "mistral-medium-3.5" vs "mistral-medium-3-5") and cannot be caught by
  // keyword or date-suffix rules.
  const excludeExact = new Set(config.modelIdExcludeExact ?? []);
  if (excludeExact.size > 0) {
    models = models.filter((m) => !excludeExact.has(m.modelId));
  }

  // Step 3: remove versioned/dated models when a clean alias already exists.
  // Keeps "gpt-4o"            and removes "gpt-4o-2024-11-20".
  // Keeps "open-mistral-nemo" and removes "open-mistral-nemo-2407".
  // Keeps "codestral-latest"  and removes "codestral-2508".
  // Pattern: strip a trailing -YYYY-MM-DD or -YYMM/-YYYYMM suffix to get a
  // base name, then check if either the base itself OR base + "-latest"
  // exists in the list. The "-latest" check handles providers like Mistral
  // that use "-latest" aliases instead of bare names.
  const modelIds = new Set(models.map((m) => m.modelId));
  models = models.filter((m) => {
    const base = m.modelId
      .replace(/-\d{4}-\d{2}-\d{2}$/, "") // strip -YYYY-MM-DD  (e.g. gpt-4o-2024-11-20)
      .replace(/-\d{4}$/, "") // strip -YYMM/-YYYYMM (e.g. mistral-medium-2505)
      .replace(/-\d{1,3}$/, ""); // strip -001/-1/-12    (e.g. gemini-2.0-flash-001)
    if (base !== m.modelId && (modelIds.has(base) || modelIds.has(`${base}-latest`))) return false;
    return true;
  });

  return models;
}
