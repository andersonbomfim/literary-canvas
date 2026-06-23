import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateWithRunpod4090 } from "./runpodClient";

const ENV_KEYS = [
  "RUNPOD_4090_ENDPOINT",
  "RUNPOD_API_KEY",
  "RUNPOD_4090_MODEL",
  "RUNPOD_4090_TIMEOUT_SECONDS",
  "RUNPOD_4090_DRY_RUN",
];

const previousEnv = new Map<string, string | undefined>();

describe("runpod client", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("builds the official RunPod runsync request from an endpoint id", async () => {
    process.env.RUNPOD_4090_ENDPOINT = "endpoint-test";
    process.env.RUNPOD_API_KEY = "secret-test-key";
    process.env.RUNPOD_4090_MODEL = "test-model";
    process.env.RUNPOD_4090_TIMEOUT_SECONDS = "120";
    process.env.RUNPOD_4090_DRY_RUN = "false";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "provider-job-1",
          status: "COMPLETED",
          output: {
            text: "Capitulo gerado com texto suficiente para validar o contrato do client RunPod sem chamar uma GPU real.",
          },
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateWithRunpod4090({
      prompt: "Escreva o capitulo com base no rascunho.",
      requestedMaxOutputWords: 1500,
      publicJobId: "gen_1",
    });

    expect(result.providerRequestId).toBe("provider-job-1");
    expect(result.text).toContain("Capitulo gerado");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.runpod.ai/v2/endpoint-test/runsync?wait=120000");
    expect(options?.headers).toMatchObject({
      accept: "application/json",
      "Content-Type": "application/json",
      authorization: "secret-test-key",
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      input: {
        model: "test-model",
        prompt: "Escreva o capitulo com base no rascunho.",
        maxOutputWords: 1500,
        metadata: {
          jobId: "gen_1",
          engine: "runpod_4090",
        },
      },
    });
  });
});
