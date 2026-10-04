import type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly name = "openai-compatible";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.apiKey = config.apiKey || process.env.REVIEWBOT_LLM_API_KEY || process.env.OPENAI_API_KEY || "dummy-key";
    this.baseUrl = (config.baseUrl || process.env.REVIEWBOT_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel || process.env.REVIEWBOT_LLM_MODEL || "gpt-4o-mini";
    this.timeoutMs = config.timeoutMs || 60000;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      temperature: request.temperature ?? 0.1,
    };

    if (request.maxOutputTokens) {
      body.max_tokens = request.maxOutputTokens;
    }

    if (request.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `LLM provider returned HTTP ${response.status} ${response.statusText}: ${errorText}`
        );
      }

      const data = (await response.json()) as any;
      const choice = data.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error("Invalid LLM response: missing choices[0].message");
      }

      const content = choice.message.content || "";
      const finishReason = choice.finish_reason;
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined;

      return {
        content,
        finishReason,
        usage,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`LLM provider request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
