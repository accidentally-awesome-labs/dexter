import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchProvider } from "../src/providers/research/factory.js";

afterEach(() => {
  delete process.env.DEXTER_RESEARCH_API_URL;
  delete process.env.DEXTER_RESEARCH_API_KEY;
});

describe("research provider factory", () => {
  it("returns null when no endpoint configured", () => {
    const provider = createResearchProvider();
    expect(provider).toBeNull();
  });

  it("fetches evidence from configured endpoint", async () => {
    const server = http.createServer((req, res) => {
      if (req.headers.authorization !== "Bearer research-token") {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ evidence: ["live-evidence-1", "live-evidence-2"] }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }

    process.env.DEXTER_RESEARCH_API_URL = `http://127.0.0.1:${address.port}`;
    process.env.DEXTER_RESEARCH_API_KEY = "research-token";

    const provider = createResearchProvider();
    if (!provider) {
      throw new Error("provider was not created");
    }
    const evidence = await provider.fetchEvidence({
      project: "demo",
      idea: "build app",
      constraints: [],
      targetUsers: [],
    });
    expect(evidence).toEqual(["live-evidence-1", "live-evidence-2"]);

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });
});
