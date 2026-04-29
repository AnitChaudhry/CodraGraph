// OpenAI / Codex adapter.
//
// Uses the openai package's Chat Completions API. Covers GPT-4o, GPT-4.1,
// Codex models. API key from `apiKey` option or OPENAI_API_KEY env var.

import OpenAI from 'openai';
import type {
  CompletionInput,
  CompletionResult,
  InferenceProvider,
  ToolCall,
} from './interface.js';

export interface OpenAIOptions {
  apiKey?: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  baseURL?: string;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 4096;

export class OpenAIInferenceProvider implements InferenceProvider {
  // Subclasses (OpenCodeInferenceProvider) override this with a different
  // literal — keep as a wider `string` type so override is permitted under
  // strict mode.
  readonly name: string = 'openai';
  private client: OpenAI;
  private defaults: { model: string; maxTokens: number };

  constructor(options: OpenAIOptions = {}) {
    this.client = new OpenAI({
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

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
    for (const m of input.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const completion = await this.client.chat.completions.create(
      {
        model,
        messages,
        max_tokens,
        temperature: input.temperature,
        tools: input.tools?.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      },
      input.timeoutMs ? { timeout: input.timeoutMs } : undefined,
    );

    const choice = completion.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] =
      choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })) ?? [];

    return {
      content,
      tokens: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: choice?.finish_reason ?? undefined,
      raw: completion,
    };
  }
}
