import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "../src/index.js";

describe("mock LLM provider", () => {
  it("returns queued responses and tracks requests", async () => {
    const mock = new MockLLMProvider(['{"test": 1}', '{"test": 2}']);

    const res1 = await mock.complete({
      system: "system prompt",
      user: "user prompt 1",
    });
    expect(res1.content).toBe('{"test": 1}');
    expect(mock.recordedRequests).toHaveLength(1);
    expect(mock.recordedRequests[0].user).toBe("user prompt 1");

    const res2 = await mock.complete({
      system: "system prompt",
      user: "user prompt 2",
    });
    expect(res2.content).toBe('{"test": 2}');
    expect(mock.recordedRequests).toHaveLength(2);
  });

  it("supports dynamic handler callback", async () => {
    const mock = new MockLLMProvider((req) => `echo:${req.user}`);
    const res = await mock.complete({ system: "sys", user: "hello" });
    expect(res.content).toBe("echo:hello");
  });
});
