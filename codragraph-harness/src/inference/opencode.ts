// OpenCode adapter.
//
// OpenCode exposes an OpenAI-compatible chat completions endpoint. We can
// reuse the OpenAI client by pointing baseURL at OpenCode's URL. This file
// is a thin wrapper that provides sensible defaults for an OpenCode
// deployment (default URL, no auth required, larger context window).

import { OpenAIInferenceProvider, type OpenAIOptions } from './openai.js';

export interface OpenCodeOptions extends OpenAIOptions {
  /** Default URL for a local OpenCode server. Override via env or option. */
  baseURL?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:4096/v1';

export class OpenCodeInferenceProvider extends OpenAIInferenceProvider {
  override readonly name: string = 'opencode';

  constructor(options: OpenCodeOptions = {}) {
    super({
      apiKey: options.apiKey ?? 'opencode-local',
      baseURL: options.baseURL ?? process.env.OPENCODE_URL ?? DEFAULT_BASE_URL,
      defaultModel: options.defaultModel ?? 'opencode-default',
      defaultMaxTokens: options.defaultMaxTokens,
    });
  }
}
