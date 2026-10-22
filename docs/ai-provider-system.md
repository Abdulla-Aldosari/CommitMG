# CommitMG AI Provider System

This document describes the AI provider pipeline of the CommitMG extension: how an AI request is routed, which component owns each step, how prompts travel to the selected provider, how responses come back, and how failures are handled. Prompt content construction is documented separately in docs/prompt-design.md; this document covers transport, routing, configuration, and error handling only.

## 1. Purpose

CommitMG generates a Conventional Commit message for the staged changes. The generation logic itself is deterministic; the language model only produces the final text. The AI layer exists to answer one question: given two prompt strings (system and user), return a trimmed text response, regardless of which provider produced it.

## 2. Core entities

- AiClient: the unified contract every consumer depends on. Its complete(systemPrompt, userPrompt, options?) method sends the two prompts and returns trimmed response text. Optional listModels() and checkRateLimits() serve the settings flow; checkConnection() is required on every client.
- CompletionOptions: { signal?, params?, trace? }, the per-request options of complete(): an AbortSignal, the user's GenerationParams, and an optional CompletionTrace that reports the request body and the parsed reply (developer diagnostics).
- GenerationParams: { reasoning?, temperature?, maxOutputTokens? }, the neutral model parameters (src/ai/params/generationParams.ts). Reasoning is one of off, low, medium, high, max. An absent field means Auto.
- ModelProfile: what one model accepts, in neutral terms: its reasoning control (none, effort, level, or budget) with the native value per level, whether it reasons by default, its temperature support (supported, unsupported, or onlyWhenReasoningOff), and the output-cap field name (src/ai/params/modelProfile.ts).
- ResolvedParams: the values one request actually carries after a profile has filtered the requested params; an absent field is never sent.
- AiSelection: a discriminated union that is the only routing information a caller supplies:
  - DirectAiSelection: pathway "direct", providerName, modelId, optional customBaseUrl (used only for the custom provider) and ollamaBaseUrl (used only for the ollama provider).
  - VsCodeAiSelection: pathway "vscode", optional modelId.
- ModelListEntry: { modelId, modelLabel }, the shape of every returned model list.
- RateLimitInfo: optional fields for request/token limits, remaining counts, and reset times in seconds.
- ProviderConfig: static metadata for a fixed provider (name, serviceName, providerName, defaultModelId, displayLabel, models, apiKeyUrl, apiKeyUrlLabel, steps, hasApiRateLimits, rateLimitsUrl, modelIdExcludeKeywords, modelIdExcludeExact).
- ModelConfig: { modelId, modelLabel, free }.
- FixedProviderName: gemini, openai, anthropic, deepseek, groq, mistral, cohere, stepfun.
- DirectProviderName: FixedProviderName or "custom" (a user-supplied OpenAI-compatible endpoint) or "ollama" (a local Ollama server speaking Ollama's native API).
- AiSettingsSnapshot: { pathway, providerName, modelId, customBaseUrl, ollamaBaseUrl, vsCodeModelId }, the persisted non-secret selection.
- VsCodeLmAccessor: a bridge interface that hides the VS Code Language Model API behind selectModels() and sendRequest() so the vscode pathway remains free of vscode imports.
- LmMessage: { role: "user", content }, the message shape the Language Model API accepts.
- LmModelDescriptor: { id, name, vendor, family }.

## 3. Dependencies and runtime requirements

- No runtime dependencies in the shipped extension: gpt-tokenizer (the Estimate Cost feature's local token counter) is inlined into out/extension.js by the esbuild bundle step (scripts/bundle.js) at build time, so node_modules stays out of the vsix. Every provider call uses the native fetch API and JSON bodies; no provider SDKs.
- The extension requires VS Code 1.90.0 or newer, which is the version that provides the vscode.lm namespace.
- The API key is the only secret involved. It is stored exclusively in the extension secret storage (context.secrets); it never appears in settings files, sync data, or the webview.

## 4. Configuration and secrets

Non-secret settings live in the VS Code configuration under the commitmg section (global target):

- commitmg.aiPathway: "direct" or "vscode"; default "direct".
- commitmg.aiProviderName: one of the ten direct names; default "gemini".
- commitmg.aiModelId: string; default empty. An empty value for a fixed direct provider means the provider's configured default model: the settings webview auto-selects and persists a real model from the live list whenever the stored id is empty or stale, the generation path resolves the live list once before the first request when no model is stored, and createAiClient falls back to the configured default as the last resort. For the vscode pathway an empty value means the first model returned by the language model accessor is used.
- commitmg.aiCustomBaseUrl: string; default empty. Read only when the provider is "custom".
- commitmg.aiOllamaBaseUrl: string; default empty. Read only when the provider is "ollama"; an empty value falls back to Ollama's standard local address (http://localhost:11434) at client construction.
- commitmg.aiVsCodeModelId: string; default empty. The selected model id for the vscode pathway.

Secrets use the key commitmg.apiKey.<providerName> for every direct provider name, including "custom"; "ollama" has no secret at all (a local server needs no key). Only a boolean key-present map ever reaches the webview; the key material itself never leaves the extension host.

The model parameters are user settings too, edited in the Speed & Context tab and declared with scope window (one value for every model, in the user or the workspace settings):

- commitmg.model.reasoning: "auto", "off", "low", "medium", "high", or "max"; default "auto".
- commitmg.model.temperature: a number from 0 to 2, or null; default null.
- commitmg.model.maxOutputTokens: an integer from 256 to 65536, or null; default null.

"auto" and null mean the provider default described in section 8. A value the chosen model does not accept is dropped by its profile and never sent. The prompt-size settings of the same tab are documented in docs/prompt-design.md section 7.

## 5. The AiClient contract

Every client, for any pathway, exposes the same contract. The contract file defines nothing else; it has no knowledge of provider behavior, models, API keys, or HTTP.

- providerName: AiClientProviderName - the identity the client was built for (a fixed direct provider, "custom", "ollama", or "vscode"); used by the model-list flow for filter lookup only.
- complete(systemPrompt, userPrompt, options?): Promise<string> - the generation path. The only method the commit message generator uses. options carries the abort signal, the GenerationParams, and the optional trace (see CompletionOptions in section 2). Direct clients report the exact body through trace.onRequest before sending it, and the parsed reply through trace.onReply before its text is checked, so a rejected reply is still reported.
- checkConnection(): Promise<void> - performs a minimal request to verify the key and connectivity; throws on failure.
- listModels?(): Promise<ModelListEntry[]> - fetches the raw live model list from the provider API; absent when the pathway has no such endpoint.
- checkRateLimits?(): Promise<RateLimitInfo> - reads rate-limit information from response headers; present on clients that can read headers. The panel additionally gates the call on the provider's hasApiRateLimits flag (not just on the method's presence), so providers without headers get the "unsupported" answer with their rate-limit page link instead of an empty reading.

## 6. The single gateway (src/ai/aiClientFactory.ts)

createAiClient(selection, apiKey, vsCodeLm?) is the only place in the codebase that maps a selection to a concrete client. No other module decides routing; every caller receives a plain AiClient and never sees a provider name, model id, or key again.

Routing rules:

- pathway "vscode": returns VsCodeLmClient wrapping the injected VsCodeLmAccessor. Throws if no accessor was provided.
- pathway "direct", per providerName:
  - gemini: GeminiClient (API key required).
  - anthropic: AnthropicClient (API key required).
  - mistral: MistralClient (API key required).
  - cohere: CohereClient (API key required).
  - openai, deepseek, groq, stepfun: OpenAiCompatibleClient with the provider's fixed base URL (API key required).
  - custom: OpenAiCompatibleClient with the user-supplied base URL. The base URL is required; the API key is optional, and an empty key means the Authorization header is omitted (for keyless local servers).
  - ollama: OllamaClient with the user-supplied base URL, falling back to OLLAMA_DEFAULT_BASE_URL (http://localhost:11434) when none is stored. Keyless: no Authorization header is ever sent.

Requirements are enforced at construction time:

- A fixed provider without a key throws: No API key configured for provider "x".
- The custom provider without a base URL throws: A base URL is required for the "custom" provider.
- A fixed provider with an empty model id resolves to the provider's configured default model (getDefaultModelId in providersConfig.ts); the custom and ollama providers pass the id through as-is.

listModelsForProvider(client) is the gateway's second entry point, for the settings model flow: it calls the client's listModels() and applies the centralized filtering pipeline from providersConfig.ts (filterProviderModels) when the client's providerName has a config; "custom", "ollama", and "vscode" pass through unfiltered. The client carries its own providerName, so neither the provider name nor the API key is ever passed separately.

## 7. Provider configuration data (src/ai/providersConfig.ts)

The single source of truth for static provider metadata:

- AI_PROVIDERS: the eight fixed providers with their models, defaultModelId, apiKeyUrl, apiKeyUrlLabel, steps, hasApiRateLimits flags, rateLimitsUrl pages, and modelIdExcludeKeywords/modelIdExcludeExact filtering rules.
- OPENAI_COMPATIBLE_BASE_URLS: the fixed base URL of each OpenAI-compatible provider (openai, deepseek, groq, stepfun).
- OLLAMA_DEFAULT_BASE_URL: http://localhost:11434, the base URL the ollama provider falls back to when none is stored.
- getProviderConfig(name) and getProvidersArray() lookup helpers.
- getDefaultModelId(name): the model id a fixed provider should use when none was chosen (defaultModelId, falling back to the first static model).
- filterProviderModels(providerName, raw): the centralized live-model filtering pipeline: keyword exclusion, duplicate-ID removal, exact-ID exclusion, and removal of dated/versioned models when a clean alias (or an alias + "-latest") exists.

Rate-limit capability (hasApiRateLimits): openai, anthropic, groq, and mistral expose rate-limit headers and therefore support checkRateLimits(); gemini, deepseek, cohere, and stepfun do not.

## 8. Provider clients (src/ai/providers/)

### Request parameters: profiles and dialects

Every direct client builds its request the same way:

1. resolveRequestParams(providerName, modelId, params) (src/ai/params/profileRules.ts) looks up the model's profile and merges the user's params over the provider defaults, then drops everything the profile rejects: a reasoning level the model does not offer, and a temperature the model refuses in the resolved reasoning state.
2. The provider's dialect (src/ai/dialects/) turns the BaseRequest (model id and the two prompts) plus the ResolvedParams into the exact JSON body, and later reads the reply: it extracts the text, skips every reasoning part, and reports the finish reason and whether the reply was cut off.
3. The client owns only transport: URL, headers, fetchJson, and readReply().

Profiles live in data, not code: the baseline table ships as capabilities.json (bundled into the extension) and capabilityStore.ts (src/ai/params/) parses, validates, and resolves it; profileRules.ts only keeps the public facade. One ordered rule table per provider, built from the capability probe measurements. A model id matches a rule exactly or after a trailing date suffix is removed (gpt-5-2025-08-07, claude-opus-4-5-20251101). An id no rule matches gets the provider's fallback profile, which sends no optional parameter any measured model of that provider rejected; the settings tab then warns that the model is unknown. modelSupport(provider, modelId) gives the settings tab the reasoning levels and temperature support of the selected model.

Provider defaults (sent when the user leaves a setting on Auto, still filtered by the profile):

| Provider                                         | Temperature | Output cap | Reasoning                                                                      |
| ------------------------------------------------ | ----------- | ---------- | ------------------------------------------------------------------------------ |
| openai, deepseek, groq, mistral, stepfun, custom | 0.2         | 8192       | none (the model's own default)                                                 |
| ollama                                           | 0.2         | 8192       | none (reasoning is not offered)                                                |
| gemini                                           | 0.2         | 8192       | medium (a 4096-token budget on Gemini 2.5, thinkingLevel "medium" on Gemini 3) |
| anthropic                                        | none        | 8192       | none                                                                           |
| cohere                                           | none        | none       | none                                                                           |

Native forms of a reasoning level:

- OpenAI, Groq, StepFun, Mistral, custom: reasoning_effort (OpenAI's "max" is "xhigh"; "off" is "none" where the model offers it).
- DeepSeek: reasoning_effort, and "off" is thinking { type: "disabled" }.
- Gemini 2.5: thinkingConfig.thinkingBudget; Gemini 3 and Gemma: thinkingConfig.thinkingLevel. The two are never sent together.
- Anthropic: output_config.effort on effort models, thinking { type: "enabled", budget_tokens } on budget models, and thinking { type: "disabled" } for "off".
- Cohere: thinking { type: "enabled", token_budget }, and thinking { type: "disabled" } for "off".
- Ollama: no reasoning control is offered.

Output cap field: max_completion_tokens for every OpenAI model, maxOutputTokens for Gemini, max_tokens elsewhere, and num_predict inside options for Ollama. On thinking models the cap includes the reasoning, so a high reasoning level with a small cap can stop the reply before the message is written (see section 10).

Reply reading: readReply() (src/ai/dialects/dialect.ts) reports the reply to the trace, then calls requireText(). A reply cut off at the output limit is rejected even when it holds text, because it ends mid-message, often inside the model's reasoning. Cut-off reasons: finishReason MAX_TOKENS (Gemini), stop_reason max_tokens (Anthropic), finish_reason MAX_TOKENS (Cohere), finish_reason length (OpenAI-style), length or model_length (Mistral), and done_reason length (Ollama).

### httpClient.ts (shared helpers)

- fetchJson(url, options): performs the request; on a non-2xx status it reads the body and throws Error("HTTP <status> from <url>: <body>"), where <url> passes through redactUrl() (origin and path only, no query string, fragment, or credentials); otherwise it returns the parsed JSON.
- fetchJsonWithResponse(url, options): the same, plus the raw Response object, so callers can read rate-limit headers without a second request.
- parseIntHeader(headers, name): returns the header value as an integer, or null.
- parseDurationHeaderSeconds(headers, name): parses duration values such as "6m0s" or "7.66s" into whole seconds.

### gemini.ts (GeminiClient)

- Every request sends the API key in the x-goog-api-key header, never in the URL.
- complete: POST https://generativelanguage.googleapis.com/v1beta/models/<modelId>:generateContent. The body carries system_instruction (the system prompt), one user part with the user prompt, and generationConfig with the resolved temperature, maxOutputTokens, and thinkingConfig (thinkingBudget on Gemini 2.5, thinkingLevel on Gemini 3 and Gemma; Gemini 3 never receives a temperature). The response is candidates[0].content.parts filtered to text parts without the thought flag, joined and trimmed. Throws "Gemini returned no usable content", appending the block reason or the finish reason when the API reports one.
- listModels: paged GET of v1beta/models (page size 100); keeps entries whose supportedGenerationMethods include generateContent and strips the models/ prefix from ids.
- checkConnection: GET models with page size 1.
- checkRateLimits: absent.

### openaiCompatible.ts (OpenAiCompatibleClient)

One implementation serves openai, deepseek, groq, stepfun, and custom.

- complete: POST <baseUrl>/chat/completions. The body carries model, messages [system, user], and the resolved temperature, output cap (max_completion_tokens for OpenAI, max_tokens for the others), and reasoning_effort (DeepSeek's "off" is thinking { type: "disabled" }). The Authorization header is sent only when a key exists. The response is choices[0].message.content, trimmed; the separate reasoning and reasoning_content fields are never read. Throws "<label> returned no usable content", appending the finish reason when present.
- listModels: GET <baseUrl>/models.
- checkConnection: GET <baseUrl>/models.
- checkRateLimits: sends a minimal chat completion and reads x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-limit-tokens, x-ratelimit-remaining-tokens, and the two reset durations.

### ollama.ts (OllamaClient)

Serves the "ollama" provider, talking Ollama's native API (not its OpenAI-compatible layer). Keyless: the Content-Type header is the only one sent, never Authorization.

- complete: POST <baseUrl>/api/chat. The body carries model, messages [system, user], stream: false, and the resolved temperature and output cap inside options (temperature, num_predict). The response is message.content, trimmed; done_reason "length" counts as cut off, any other missing content throws "Ollama returned no usable content".
- listModels: GET <baseUrl>/api/tags; every models[].name becomes { modelId, modelLabel }.
- checkConnection: GET <baseUrl>/api/tags.
- checkRateLimits: absent.

### anthropic.ts (AnthropicClient)

- complete: POST https://api.anthropic.com/v1/messages with headers x-api-key and anthropic-version 2023-06-01. The body carries model, max_tokens (required by the API; 8192 when none is resolved), system (the system prompt), one user message, and the resolved temperature, output_config.effort, or thinking. The response content blocks are filtered to type text (thinking blocks are skipped), joined, and trimmed. Throws "Anthropic returned no usable content", appending the stop reason when present.
- listModels: GET /v1/models.
- checkConnection: GET /v1/models?limit=1.
- checkRateLimits: sends a minimal messages request and reads anthropic-ratelimit-requests-limit/-remaining and anthropic-ratelimit-tokens-limit/-remaining.

### mistral.ts (MistralClient)

- complete: POST https://api.mistral.ai/v1/chat/completions. The body is the OpenAI-style body with max_tokens and the resolved reasoning_effort. When a model reasons, message.content arrives as a list of chunks: a "thinking" chunk (its own text nested inside) followed by "text" chunks; only the top-level text chunks are joined. A plain string reply is read as before. Throws "Mistral returned no usable content", appending the finish reason when present, or "only reasoning, no answer" when the list holds no text chunk.
- listModels: GET /models.
- checkConnection: GET /models.
- checkRateLimits: reads x-ratelimit-limit-req-minute, x-ratelimit-remaining-req-minute, x-ratelimit-limit-tokens-minute, and x-ratelimit-remaining-tokens-minute.

### cohere.ts (CohereClient)

- complete: POST https://api.cohere.com/v2/chat. The body carries model and messages [system, user]; temperature and max_tokens are sent only when the user sets them, and thinking only when the user picks a reasoning level the model offers. The response message.content blocks are filtered to type text (thinking blocks are skipped), joined, and trimmed. Throws "Cohere returned no usable content", appending the finish reason when present.
- listModels: GET https://api.cohere.com/v1/models?page_size=200&endpoint=chat.
- checkConnection: GET /v1/models with page size 1.
- checkRateLimits: absent.

## 9. The VS Code Language Model pathway

### src/ai/vsCodeLmClient.ts

Defines the pathway without importing vscode, so the pathway stays free of environment coupling:

- VsCodeLmAccessor: the bridge interface with selectModels(): Promise<LmModelDescriptor[]> and sendRequest(modelId, messages, signal?): Promise<string>. An aborted signal cancels the request through a CancellationToken.
- The pathway ignores GenerationParams and the trace: the Language Model API exposes no reasoning, temperature, or output-cap option, and no request or reply body. The settings tab disables the model parameters for this pathway and says so.
- VsCodeLmClient implements AiClient:
  - complete: the Language Model API has no separate system role, so the two prompts are merged into a single user message (system prompt, blank line, user prompt). When no model id was selected, the first model returned by selectModels() is used. When no model is available at all, it throws "No VS Code language model is available...".
  - listModels: maps the accessor's descriptors to ModelListEntry objects.
  - checkConnection: sends the single word "Hi" through the accessor.

### src/settings/vsCodeLmAccessorImpl.ts

The only implementation of the accessor, and the only file that calls the vscode.lm API directly:

- selectModels: calls vscode.lm.selectChatModels() and maps each result to { id, name, vendor, family }.
- sendRequest: selects the model by id through vscode.lm.selectChatModels({ id }), builds one vscode.LanguageModelChatMessage.User(...) per message, calls model.sendRequest(...), and concatenates the fragments of the response text stream. A model id that matches nothing throws; a vscode.LanguageModelError is rethrown as a plain Error carrying its code and message with the original error preserved as the cause.

## 10. Error model and normalization

Every client throws plain Error objects. Two failure families exist:

1. Transport failures: fetchJson throws Error("HTTP <status> from <url>: <body>") where the body is the raw response the provider returned.
2. Response-shape failures: each client validates the parsed payload and throws "<Provider> returned no usable content" (with the block, stop, or finish reason when available) when the expected text content is missing.
3. Cut-off replies: a reply that stopped at the output limit throws "<Provider> stopped at the output limit before finishing the message (<reason>). Raise Maximum output or lower Reasoning in CommitMG Settings > Speed & Context." even when it holds some text.

The generation engine adds two more:

- Timeout: a request that runs longer than the configured timeout (commitmg.generation.timeoutSeconds, default 120 s) is aborted with "The model did not answer within N seconds...". The timeout applies to each request separately.
- Cancellation: the user's cancel aborts the in-flight request and rejects with GenerationCancelledError, which the caller treats as a choice, not a failure: nothing is inserted and nothing is reported.

src/ai/extractAiErrorMessage.ts normalizes either family into one user-facing message: it extracts the body from the "HTTP <status> from <url>: <body>" pattern, parses it as JSON, and returns the nested error.message (or the top-level message) when present; otherwise it returns the raw message. This normalized text is what the settings flow reports back to the webview and what the generation flow shows in the error notification.

The commit message generator does not catch AI errors; they propagate to extension.ts, which displays them (and, when developer diagnostics are enabled, records them).

## 11. Prompt transport (relationship with src/generation/)

generateCommitMessage(repoRoot, style, aiClient, observer?, run?) is the only consumer of AiClient.complete(). run (GenerationRunOptions) carries the abort signal, the per-request timeout, the prompt-size options, the GenerationParams, and autoCorrect; extension.ts fills it from readRunSettings() (src/settings/settingsStore.ts). Its sequence:

1. The prompts are built from the repository state with the run's options. The rules that shape the prompt text are documented in docs/prompt-design.md.
2. complete(systemPrompt, userPrompt, { signal, params, trace }) is called under the timeout, and the returned text is validated against the project rules (from commitlint, .commitmgrc.json, or the built-in defaults) and the header form; the type emoji, when enabled, is added afterwards by code.
3. When violations exist and autoCorrect is on (the default), a corrected system prompt is assembled: the original system prompt plus the previous output verbatim plus the violation list, instructing the model to fix only the listed issues. complete() is called exactly once more with the same user prompt. No further retries occur. With autoCorrect off, the first message is returned and its violations are still reported.
4. The observer callbacks report the lifecycle events to the caller: onStage (collecting, requesting, validating, correcting), onPromptsBuilt, onRequest and onReply (per attempt, "first" or "correction"), onFirstAttempt, onCorrection, and onCompleted.

The module never reads the provider name, model id, API key, or URLs. Request and reply bodies pass through it only as opaque values for the observer. It is silent: failures throw, and the caller displays them.

## 12. Settings host side

### src/settings/settingsStore.ts

The only settings-related module that reads and writes storage:

- readAiSettings / writeAiSettings: the configuration keys listed above.
- readApiKey / writeApiKey / deleteApiKey: secret storage under commitmg.apiKey.<providerName>.
- readAllKeyStatuses: a boolean key-present map for all nine direct names, the only key-related data ever sent to the webview.
- toAiSelection: converts a settings snapshot into an AiSelection.
- readUserSettingsView: every CommitMG setting kept in VS Code (Speed & Context and Message Format, declared in src/settings/userSettings.ts) with its value and source layer (workspace, user, or default), for the settings tabs.
- readRunSettings: the options, params, autoCorrect flag, and timeout one generation runs with, derived from those settings (a named preset's values, or the individual values under Custom; the Message Format values become the convention, emoji position, bullet spacing, and extra instructions of the options).
- readButtonStyle: the style the Source Control button generates with (commitmg.format.defaultDetail), or null to show the style picker.
- readRunSnapshot: the same plus the AI selection and every stored value with its source, for the developer session record. It never reads the API key, and the custom base URL keeps only its origin and path.
- writeUserSetting / resetUserSetting: validate a key and value from the webview (a trust boundary), then write to or remove from one layer per edit (planStoredEdit): the workspace when it defines any setting the edit writes, the user settings otherwise, so a preset switch never splits across layers. A value that only repeats the default is removed from the user settings. A preset switch writes the copied values first and the preset last, one write at a time. copySettingToWorkspace copies a setting stored in the user settings, with its current value, to the workspace settings.
- buildConfiguredAiClient(context): reads the settings, builds the selection, and creates the client with the key from secret storage, or with a VsCodeLmAccessorImpl for the vscode pathway. For a fixed provider with no stored model, it first resolves one from the live list (the provider's default when still listed, else the first live model), persists the resolved id, and only then builds the client; a failed listing falls through to the gateway's static default. This is the single call site extension.ts uses before generating.

### src/settings/settingsPanel.ts

The host side of the settings webview. It persists selections and keys and executes every provider request the webview initiates. The AI-related messages and their effect:

- selectProvider, selectVsCodePathway, selectModel, selectVsCodeModel, setCustomBaseUrl: persist the corresponding setting and push fresh state.
- saveApiKey, deleteApiKey: write or delete the secret and push fresh state.
- refreshModel {selection}: builds the client for exactly that selection and calls listModelsForProvider(client), which fetches the live list and applies the centralized filtering; posts modelsResult { cacheKey, success, models | message } where cacheKey is "vscode" or the provider name.
- refreshAllModels: collects every fixed provider with a saved key, plus the custom provider when a base URL is configured, plus the vscode pathway; fetches all of them in parallel with Promise.allSettled, each posting its own modelsResult.
- checkConnection: posts connectionResult { success, message? }.
- checkRateLimits: posts rateLimitsResult { success, supported, info | message, rateLimitsUrl? }. The call is gated on the provider's hasApiRateLimits flag (not just on the client method), so providers without headers get supported:false with their rate-limit page link; a successful call whose headers are all absent (e.g. a custom server that exposes none) is also reported as supported:false.
- estimateCost: posts costEstimateResult { success, result | message }. Provider-independent by design: the handler measures the first Git repository in the workspace by running generateCommitMessage() once per commit style with a recording client (see RecordingAiClient) that captures the built prompts without sending them, counts the tokens locally, and applies the fixed benchmark pricing table from src/ai/estimatePromptCost.ts (BENCHMARK_PRICES + PRICING_RETRIEVED_AT). No API key and no network call are involved.

- setUserSetting {key, value}, resetUserSetting {key}, and copySettingToWorkspace {key}: write, remove, or copy to the workspace one VS Code setting (Speed & Context, Message Format, or the excluded scopes) through settingsStore. The state carries hasWorkspace; the User source badge is clickable only when it is true. The panel skips the change events of its own writes and pushes one state when the edit has finished, whether it succeeded or not.
- measurePromptSize {requestId}: builds the real prompt for the workspace repository's current changes with the current settings (medium style), counts it locally, and posts promptSizeResult { requestId, success, tokens, chars, style, repoName | message }. Nothing is sent to a provider. The state carries hasRepo (whether the workspace has a Git repository; it cannot change while the panel is open). Without a repository the Speed & Context tab never sends this message: it shows a short description and a disabled Measure again button.

Any change to the commitmg configuration from outside the panel (the Settings editor or settings.json) also pushes a fresh state, once per burst of change events.

The state pushed to the webview carries the settings snapshot, the boolean key-status map, the full static provider configuration, every CommitMG VS Code setting with its source (userSettings), the options the next generation will use, the input ranges, modelSupport for the selected direct model (null for the vscode pathway), and the rules view of the open repository (its active source, types, limits, scope policy, scopes, and whether .commitmgrc.json can be edited).

## 13. Settings client side (relationship with media/settingsMain.js)

The webview client never contacts provider APIs and never holds API keys. Its AI responsibilities:

- It owns the model-list cache: one localStorage entry per cache key, each holding { models, fetchedAt }, valid for 7 days.
- On every state update it re-resolves the current selection. When the cached list for that selection is missing or expired and the selection can make requests (a direct provider with a key, the custom provider with a base URL, or the vscode pathway), it sends refreshModel for that single selection. A fresh cache is used with no network call at all.
- An explicit user request sends refreshAllModels, which refreshes every eligible selection at once; every result is cached under its own key regardless of which selection is displayed.
- Saving or deleting an API key clears that provider's cache entry, so the next state update fetches the list again.
- Whenever the current model list is available (cache or fresh fetch), the webview auto-selects a real model when the stored id is empty or no longer listed: the provider's default when still present, else the first entry. The choice is persisted immediately, so the dropdown, settings, and requests always agree and the custom-select button never fakes a selection.
- The Estimate Cost button (present in both the direct and the vscode sections, since it needs no provider or key) opens a dedicated wide modal with a spinner first (the measurement can take seconds on large change sets), then fills the same modal with a token table per style and a fixed model x style cost comparison. The modal has no OK button (only its close X), a fixed chartBar title icon, and outside-click dismissal disabled so stray presses flash its border instead of closing the report. The footer notes that token counts are exact for OpenAI models and approximate for DeepSeek and Gemini, plus the pricing retrieval date.
- Every popup modal follows one dismiss contract: data-dismiss-on-outside-click="true" closes the modal on an outside press, "false" keeps it open and flashes its box border instead; Escape always closes whichever modal is open.

The tabs are listed in one TABS registry in settingsMain.js, in order AI Settings, Speed & Context, Message Format, Rules; the tab bar is built from it. The three component tabs are built from the components under media/components/ and talk to the host only through messages:

- Speed & Context (media/tabs/speedTab.js): setUserSetting, resetUserSetting, measurePromptSize.
- Message Format (media/tabs/formatTab.js): setUserSetting and resetUserSetting for the commitmg.format.* settings. View Examples opens the shared message modal with one sample per detail level, built by formatExamples() in the logic bundle without a request to the host.
- Rules (media/tabs/rulesTab.js): setRulesField {field, value}, createRulesFile {template}, and openRulesSource. The host side (src/settings/rulesSettings.ts) reads the one active rules source, and edits only .commitmgrc.json, checking every value with the same checks a generation reads the file with. A file watcher on the commitlint configs and .commitmgrc.json redraws the panel when one of them changes.

The Speed & Context tab's model section:

- The Reasoning slider offers Auto plus the levels modelSupport lists for the selected model. A stored level the model does not offer is shown as Auto with an "unsupported" badge, because the profile drops it.
- Temperature carries a "partly supported" badge for models that accept it only while reasoning is off, and "not supported" for models that reject it.
- An unknown model (fallback profile) shows a warning banner; the vscode pathway shows a note that these settings apply to direct providers, and the controls are disabled.

## 14. The extension entry link (src/extension.ts)

- activate() registers five commands: the commit message command (the Source Control button), which generates with the default detail level when commitmg.format.defaultDetail names one and otherwise shows the style picker, whose list includes an entry that opens the settings panel; commitmg.insertCommitMessageWithStyle, which always shows the picker (listed in the Source Control menu when a default level is set); a direct command that opens the settings panel; a developer-only prompt preview command that builds and shows the prompts without sending them, and the developer-only capability probe (commitmg.probeModelCapabilities, src/dev/probe/), which sends test requests to measure which parameters each provider model accepts and writes a report under probe-reports/ in the extension global storage. The Developer tab of CommitMG Settings (visible only inside the Extension Development Host, via context.extensionMode) drives the same probe per model, transcribes the accepted cases into a stored profile (profileFromOutcomes.ts), and merges it into the source capabilities.json through the same pure merge the unit tests use (mergeRuleIntoCapabilitiesFile), so measured capabilities ship with the next build and apply to the running dev host immediately. Ollama models are measured from their own metadata instead: one POST /api/show call (ollamaModelInfo.ts) describes each model's thinking controls, and profileFromOllamaModelInfo transcribes it into the same stored profile (a "think" reasoning control with boolean or model-defined level values).
- The generation path inside extension.ts is: read the run settings (readRunSettings), build the client through buildConfiguredAiClient(context), then call generateCommitMessage(repoRoot, style, aiClient, observer, { signal, ...runSettings }) inside a cancellable progress notification that shows each stage. The observer shows the validation notifications, and any thrown error except a cancellation is shown as an error message. The returned text is placed into the source control input box.
- Developer diagnostics are opt-in: when commitmg.developer.enabled is on, a DevSessionRecorder (src/dev/devSessionRecorder.ts) joins the run as an extra observer and writes one session folder per generation under the extension global storage (dev-sessions/<timestamp>/), logging every created file path to the "Commit MG Developer" output channel. The recorder never runs in the default configuration and the core generation path never imports it. A session folder holds:
  - meta.json: the AI selection, every CommitMG VS Code setting with its source layer, the active project rules source, the derived run settings, the prompt size in characters and tokens, each attempt's model id, finish reason, cut-off flag, and violations, and the outcome (running, completed, failed, or cancelled) with the error message. It is rewritten after every step, so a hung or crashed run still leaves a current summary.
  - prompt-system.md and prompt-user.md: the exact prompts.
  - request-<n>.json and reply-<n>.json: the exact body sent and the parsed reply for attempt n (1 = first, 2 = correction), direct providers only; the reply is written even when it is rejected.
  - attempt-<n>.md and attempt-<n>-violations.txt: each message and its problems.
  - final.md, or error.log with the error and every cause under it.
    No API key is recorded, and the custom base URL keeps only its origin and path.

## 15. End-to-end call flows

Generation:
extension.ts -> readRunSettings -> buildConfiguredAiClient -> (live model resolution when none is stored) -> createAiClient -> generateCommitMessage -> client.complete(system, user, { signal, params, trace }) -> resolveRequestParams + dialect body -> provider HTTP API or vscode.lm -> readReply (cut-off check) -> response text -> validation -> optional single correction complete() -> final text -> source control input box.

Prompt size:
webview -> measurePromptSize {requestId} -> settingsPanel -> buildPromptForRepo with the current options (no send) -> local token count -> promptSizeResult -> the Speed & Context tab, which drops a result older than its latest request.

Single model refresh:
webview -> refreshModel {selection} -> settingsPanel -> createAiClient -> listModelsForProvider(client) -> client.listModels() + centralized filtering -> provider API -> modelsResult -> webview caches the list.

Full model refresh:
webview -> refreshAllModels -> settingsPanel -> one fetch per eligible selection in parallel -> one modelsResult per selection -> webview caches each list.

Connection check:
webview -> checkConnection -> settingsPanel -> createAiClient -> client.checkConnection() -> connectionResult.

Rate-limit check:
webview -> checkRateLimits -> settingsPanel -> client.checkRateLimits() -> rateLimitsResult, or a supported:false result when the client has no such method.

Cost estimate:
webview -> estimateCost -> settingsPanel -> generateCommitMessage per style with a recording client (no send) -> local token counts -> benchmark pricing table -> costEstimateResult -> webview comparison tables.

## 16. Behavior matrix

- Generation with a fixed provider that has no saved key: createAiClient throws before any request is sent; the error is displayed.
- Generation with the custom provider and no base URL: createAiClient throws the base URL requirement.
- Generation with the ollama provider and no stored base URL: the client falls back to Ollama's standard local address (http://localhost:11434).
- Generation through the vscode pathway with no available models: VsCodeLmClient throws the availability error.
- A selected vscode model that is no longer available: sendRequest throws a model id mismatch error.
- A provider returns a non-2xx status: fetchJson throws the HTTP context error, extractAiErrorMessage normalizes the provider's JSON message, and the normalized text is displayed.
- A provider returns a payload without usable content: the client throws its no-usable-content error including the block, stop, or finish reason.
- A reply stops at the output limit (cut off): the client throws the cut-off error naming the provider's reason, even when the reply holds text; nothing is inserted.
- A reply whose first line is not a conventional header (a code fence, an explanation, leaked reasoning): validateHeaderMeta reports it as a violation, so the correction retry fixes it, and with correction off the warning names it.
- The generated message violates rules: one automatic correction retry runs with the corrected system prompt (unless commitmg.generation.autoCorrect is off); remaining violations are reported, and the final text is still returned for review.
- A model does not accept a chosen setting (a reasoning level it does not offer, a temperature it rejects): the profile drops the value and the request is sent without it; the settings tab marks it with a support badge.
- A request runs past the timeout: it is aborted with the timeout error. The user cancels: the request is aborted and nothing is shown.
- The webview has no fresh cache and requests are possible: it fetches exactly that selection automatically.
- Live model lists are centrally filtered: keyword-excluded, duplicate, exact-excluded, and dated/versioned models never reach the webview; "custom", "ollama", and "vscode" lists pass through raw.
- A fixed provider with no stored model: the settings webview auto-selects a real listed model; the generation path resolves one from the live list on the first request and persists it; createAiClient falls back to the configured default as the last resort.
- The dropdown never fakes a selection: an empty or stale stored model id is auto-replaced with the default (when still listed) or the first live model, and that choice is persisted immediately.
- Check Rate Limits for a provider without rate-limit headers (hasApiRateLimits false): no request is sent; the webview gets supported:false with the provider's rate-limit page link. The same unsupported answer replaces an otherwise-successful reading whose headers are all absent.
- Estimate Cost with no Git repository in the workspace: the webview gets an error asking the user to open one; with no changes staged or unstaged, generateCommitMessage's no-changes error is shown instead.
- Estimate Cost never reads the selected provider or any API key: the pricing table is a fixed benchmark set, and the measurement runs entirely offline.
- The user requests a full refresh: all eligible selections refresh in parallel and every result is cached.

## 17. Design principles

- One gateway: aiClientFactory is the only module that maps a selection to a client and the only module that fetches + filters live model lists (listModelsForProvider); no other module knows provider names or endpoints.
- One contract: everything that generates text depends only on AiClient.complete.
- Measured, not assumed: what each model accepts comes from the capability probe and lives in capabilities.json (data, not code); a model nobody measured gets only what every measured model of its provider accepts. A request never carries a parameter its model rejects.
- Clients move bytes, dialects shape them: the request body and the reply reading are pure functions per wire format, tested with exact golden bodies.
- The prompt builder is provider-agnostic and environment-free: it never imports vscode and never reads keys.
- Secrets stay in the extension host: keys live in secret storage and are read only where a client is constructed.
- Transport is explicit: all provider calls are plain fetch requests; the webview is a thin client of the host-side panel.
- Errors are plain and normalized once: clients throw, extractAiErrorMessage normalizes, and the caller displays.
- What you see is what runs: the model shown as selected in the settings dropdown is always the model persisted in settings and the model sent to the provider; empty or stale selections are auto-replaced from the live list.
