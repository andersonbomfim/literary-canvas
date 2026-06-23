import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekGenerationError, invokeDeepSeek } from "./deepseekClient";

const ENV_KEYS = [
  "DEEPSEEK_ENABLED",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_TIMEOUT_SECONDS",
  "DEEPSEEK_FREE_MODEL",
  "DEEPSEEK_ESSENTIAL_MODEL",
  "DEEPSEEK_ULTRA_MODEL",
  "DEEPSEEK_REVIEW_MODEL",
  "DEEPSEEK_INSPIRATION_MODEL",
  "DEEPSEEK_FREE_MAX_TOKENS",
  "DEEPSEEK_REVIEW_MAX_TOKENS",
];

const previousEnv = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;

function configureDeepSeek() {
  process.env.DEEPSEEK_ENABLED = "true";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://deepseek.test";
  process.env.DEEPSEEK_FREE_MODEL = "deepseek-free";
  process.env.DEEPSEEK_REVIEW_MODEL = "deepseek-review";
  process.env.DEEPSEEK_FREE_MAX_TOKENS = "2000";
  process.env.DEEPSEEK_REVIEW_MAX_TOKENS = "4000";
}

function mockResponse(status: number, body: unknown, statusText = "OK") {
  return Promise.resolve(new Response(JSON.stringify(body), { status, statusText }));
}

describe("DeepSeek client", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    configureDeepSeek();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the configured model and extracts the assistant content", async () => {
    const fetchMock = vi.fn(() => mockResponse(200, {
      id: "ds_1",
      created: 1,
      model: "deepseek-free",
      choices: [{ index: 0, message: { role: "assistant", content: "Capitulo gerado." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await invokeDeepSeek({
      task: "generate",
      planTier: "free",
      messages: [{ role: "user", content: "Rascunho" }],
    });

    expect(result.id).toBe("ds_1");
    expect(result.choices[0].message.content).toBe("Capitulo gerado.");
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.model).toBe("deepseek-free");
    expect(payload.max_tokens).toBe(2000);
  });

  it("maps auth and rate-limit failures without leaking prompt text", async () => {
    globalThis.fetch = vi.fn(() => mockResponse(401, { error: { message: "denied" } }, "Unauthorized")) as typeof fetch;

    await expect(invokeDeepSeek({
      task: "review",
      planTier: "ultra",
      messages: [{ role: "user", content: "texto privado" }],
    })).rejects.toMatchObject({ code: "deepseek_auth_error" });
  });

  it("rejects empty assistant output", async () => {
    globalThis.fetch = vi.fn(() => mockResponse(200, {
      id: "ds_empty",
      created: 1,
      model: "deepseek-free",
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
    })) as typeof fetch;

    await expect(invokeDeepSeek({
      task: "generate",
      planTier: "free",
      messages: [{ role: "user", content: "Rascunho" }],
    })).rejects.toBeInstanceOf(DeepSeekGenerationError);
  });
});
