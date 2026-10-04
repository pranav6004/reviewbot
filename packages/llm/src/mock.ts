import type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

export type MockHandler = (request: LLMRequest) => Promise<string> | string;

export class MockLLMProvider implements LLMProvider {
  public readonly name = "mock";
  private responses: string[] = [];
  private handler?: MockHandler;
  public recordedRequests: LLMRequest[] = [];

  constructor(presetResponses?: string[] | MockHandler) {
    if (typeof presetResponses === "function") {
      this.handler = presetResponses;
    } else if (Array.isArray(presetResponses)) {
      this.responses = [...presetResponses];
    }
  }

  setResponses(responses: string[]) {
    this.responses = [...responses];
  }

  setHandler(handler: MockHandler) {
    this.handler = handler;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.recordedRequests.push(request);

    let content = "";
    if (this.handler) {
      content = await this.handler(request);
    } else if (this.responses.length > 0) {
      content = this.responses.shift()!;
    } else {
      content = JSON.stringify({
        schemaVersion: "review-output-v1",
        summary: "Mock summary: all changes look clean.",
        walkthrough: [],
        findings: [],
      });
    }

    return {
      content,
      finishReason: "stop",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
  }
}
