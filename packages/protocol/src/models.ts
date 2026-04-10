/**
 * Static model registry — defines the available models per provider.
 *
 * Lives in @dough/protocol (zero-dep) so TUI can render the model selector
 * instantly without a server round-trip, while the server uses the same
 * source of truth for validation.
 */

export interface ModelInfo {
  /** Short alias used internally and passed to the provider (e.g. "sonnet", "opus"). */
  id: string;
  /** Full API model identifier (e.g. "claude-sonnet-4-6"). */
  apiId: string;
  /** Human-readable display name (e.g. "Claude Sonnet 4.6"). */
  name: string;
  /** Provider this model belongs to. */
  provider: "claude" | "codex";
  /** Whether this is the default model for its provider. */
  isDefault?: boolean;
}

export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  // ── Claude (via @anthropic-ai/claude-agent-sdk) ───────────────────
  {
    id: "sonnet",
    apiId: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "claude",
    isDefault: true,
  },
  {
    id: "opus",
    apiId: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "claude",
  },
  {
    id: "haiku",
    apiId: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "claude",
  },

  // ── Codex / OpenAI (via @openai/codex-sdk) ────────────────────────
  {
    id: "gpt-5.4",
    apiId: "gpt-5.4",
    name: "GPT-5.4",
    provider: "codex",
    isDefault: true,
  },
  {
    id: "gpt-5.4-mini",
    apiId: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "codex",
  },
  {
    id: "gpt-5.3-codex",
    apiId: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "codex",
  },
  {
    id: "gpt-5.3-codex-spark",
    apiId: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    provider: "codex",
  },
] as const;

/** Get models available for a specific provider. */
export function getModelsForProvider(provider: string): ModelInfo[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider);
}

/** Get the default model for a provider. */
export function getDefaultModelForProvider(provider: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.provider === provider && m.isDefault);
}

/** Look up a model by its short alias, optionally scoped to a provider. */
export function findModel(id: string, provider?: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find(
    (m) => m.id === id && (provider == null || m.provider === provider),
  );
}
