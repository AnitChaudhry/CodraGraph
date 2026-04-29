// Inference provider registry — picks an adapter by name. Used by the CLI's
// --inference flag and the SDK's high-level `search()` entry point.
//
// Resolution order for credentials (highest priority first):
//   1. options.apiKey passed by the caller
//   2. ~/.codragraph/config.json `providers[name]` (canonical, multi-provider)
//   3. ~/.codragraph/config.json legacy flat fields (when `provider === name`)
//   4. process.env[<PROVIDER>_API_KEY]
//
// The codragraph-shared module owns step 2/3 — we lazy-import so this
// package stays usable even when codragraph isn't installed (tests +
// stand-alone harness use cases). When the codragraph file lookup
// fails, we silently fall back to step 4.

import { ClaudeInferenceProvider } from "./claude.js";
import { OpenAIInferenceProvider } from "./openai.js";
import { OpenCodeInferenceProvider } from "./opencode.js";
import type { InferenceProvider } from "./interface.js";

export { ClaudeInferenceProvider, OpenAIInferenceProvider, OpenCodeInferenceProvider };
export * from "./interface.js";

export type ProviderName = "claude" | "openai" | "opencode";

interface ResolvedCreds {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * Read provider credentials from the unified `~/.codragraph/config.json`.
 * Falls back to env vars when the codragraph package isn't installed or
 * the config file doesn't have an entry for this provider. Best-effort —
 * never throws.
 */
const resolveCredsFromConfig = async (
  name: ProviderName,
): Promise<ResolvedCreds | null> => {
  try {
    // Lazy import so codragraph stays a soft runtime dep.
    const moduleId: string = "codragraph/dist/storage/repo-manager.js";
    const mod = (await import(/* @vite-ignore */ moduleId)) as {
      loadCLIConfig?: () => Promise<unknown>;
      getProviderConfig?: (
        config: unknown,
        name: ProviderName,
      ) => { apiKey?: string; baseUrl?: string; model?: string } | null;
    };
    if (!mod.loadCLIConfig || !mod.getProviderConfig) return null;
    const config = await mod.loadCLIConfig();
    const cfg = mod.getProviderConfig(config, name);
    if (!cfg) return null;
    const out: ResolvedCreds = {};
    if (cfg.apiKey) out.apiKey = cfg.apiKey;
    if (cfg.baseUrl) out.baseURL = cfg.baseUrl;
    if (cfg.model) out.model = cfg.model;
    return out;
  } catch {
    return null;
  }
};

export interface MakeInferenceProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * Convenience factory. Picks a provider by name and wires credentials
 * from (1) caller options, (2) `~/.codragraph/config.json`, (3) env.
 *
 * Returns a Promise so config-file resolution is async-safe. Callers
 * that want sync behaviour can pass options.apiKey directly and the
 * config file lookup is a no-op.
 */
export async function makeInferenceProvider(
  name: ProviderName,
  options: MakeInferenceProviderOptions = {},
): Promise<InferenceProvider> {
  const fromConfig = (await resolveCredsFromConfig(name)) ?? {};
  const merged: MakeInferenceProviderOptions = {
    apiKey: options.apiKey ?? fromConfig.apiKey,
    baseURL: options.baseURL ?? fromConfig.baseURL,
    model: options.model ?? fromConfig.model,
  };
  switch (name) {
    case "claude":
      return new ClaudeInferenceProvider({
        apiKey: merged.apiKey,
        ...(merged.model ? { model: merged.model } : {}),
      });
    case "openai":
      return new OpenAIInferenceProvider({
        apiKey: merged.apiKey,
        ...(merged.baseURL ? { baseURL: merged.baseURL } : {}),
        ...(merged.model ? { model: merged.model } : {}),
      });
    case "opencode":
      return new OpenCodeInferenceProvider({
        apiKey: merged.apiKey,
        ...(merged.baseURL ? { baseURL: merged.baseURL } : {}),
        ...(merged.model ? { model: merged.model } : {}),
      });
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown inference provider: ${exhaustive as string}`);
    }
  }
}
