export interface LLMRequest {
  system: string;
  user: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: "json_object" | "text";
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  finishReason?: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
