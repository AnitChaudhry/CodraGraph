import type { Message, TokenUsage } from "../types.js";

/**
 * InferenceProvider — provider-agnostic completion interface.
 *
 * Implementations: claude.ts (Anthropic SDK), openai.ts (OpenAI/Codex),
 * opencode.ts (local OpenCode HTTP). Adding a new provider is one file.
 *
 * Harnesses receive an `InferenceProvider` via `HarnessContext` and never
 * import a concrete provider directly — this is what makes "works with any
 * inference" cheap.
 */
export interface InferenceProvider {
  /** Stable identifier: "claude" | "openai" | "opencode" | ... */
  readonly name: string;

  complete(input: CompletionInput): Promise<CompletionResult>;
}

export interface CompletionInput {
  messages: Message[];
  /** Provider-specific model id. If omitted, the provider picks a default. */
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  /** 0..1; provider-clamped if out of range. */
  temperature?: number;
  /** Optional tool definitions for tool-using completions. */
  tools?: ToolDefinition[];
  /** Hard timeout for this single call, milliseconds. */
  timeoutMs?: number;
}

export interface CompletionResult {
  content: string;
  tokens: TokenUsage;
  toolCalls?: ToolCall[];
  /** Reason the model stopped: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | provider-specific. */
  stopReason?: string;
  /** Provider-specific full response, kept for trace logging — do not depend on shape. */
  raw?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** A unique id within the completion, used to correlate result messages. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
