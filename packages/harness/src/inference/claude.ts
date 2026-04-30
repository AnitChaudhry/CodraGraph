// Anthropic Claude adapter.
//
// Uses @anthropic-ai/sdk Messages API. API key from `apiKey` option or
// ANTHROPIC_API_KEY env var.

import Anthropic from '@anthropic-ai/sdk';
import type {
  CompletionInput,
  CompletionResult,
  InferenceProvider,
  ToolCall,
} from './interface.js';

export interface ClaudeOptions {
  apiKey?: string;
  /** Default model id; overrideable per-call via CompletionInput.model. */
  defaultModel?: string;
  /** Default max output tokens. */
  defaultMaxTokens?: number;
  baseURL?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

export class ClaudeInferenceProvider implements InferenceProvider {
  readonly name = 'claude';
  private client: Anthropic;
  private defaults: { model: string; maxTokens: number };

  constructor(options: ClaudeOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.defaults = {
      model: options.defaultModel ?? DEFAULT_MODEL,
      maxTokens: options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const model = input.model ?? this.defaults.model;
    const max_tokens = input.maxTokens ?? this.defaults.maxTokens;

    const response = await this.client.messages.create(
      {
        model,
        max_tokens,
        system: input.systemPrompt,
        temperature: input.temperature,
        messages: input.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        tools: input.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          // Cast through unknown — SDK type names for InputSchema have moved
          // across versions; duck-typing the shape is more portable.
          input_schema: t.parameters as unknown as never,
        })),
      },
      input.timeoutMs ? { timeout: input.timeoutMs } : undefined,
    );

    // Duck-typing the content blocks avoids depending on which symbol path
    // (Anthropic.TextBlock vs Anthropic.Messages.TextBlock) the installed
    // SDK version exports.
    type TextBlock = { type: 'text'; text: string };
    type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };

    const textContent = (response.content as Array<TextBlock | ToolUseBlock | { type: string }>)
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls: ToolCall[] = (
      response.content as Array<TextBlock | ToolUseBlock | { type: string }>
    )
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments: b.input as Record<string, unknown>,
      }));

    return {
      content: textContent,
      tokens: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason ?? undefined,
      raw: response,
    };
  }
}
