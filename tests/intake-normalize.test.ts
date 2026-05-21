import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";
import { normalizeFromCliPrompt, normalizeFromIssuePayload } from "../src/intake/normalize.js";
import { validateIntakeBrief } from "../src/intake/schema.js";
import { writeIntakeArtifact } from "../src/intake/write-artifact.js";

describe("intake normalization", () => {
  it("normalizes cli prompt input", () => {
    const brief = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "  Build an internal billing API.  Include audit logs.  ",
      constraints: ["SOC2", "soc2", "  type-safe  "],
      targetUsers: ["finance-ops", "finance-ops"],
    });

    expect(brief.schemaVersion).toBe("1.0");
    expect(brief.source.type).toBe("cli-prompt");
    expect(brief.request.constraints).toEqual(["SOC2", "type-safe"]);
    expect(brief.request.targetUsers).toEqual(["finance-ops"]);
    expect(brief.title.length).toBeGreaterThan(3);
    expect(() => validateIntakeBrief(brief)).not.toThrow();
  });

  it("normalizes issue payload into same contract shape", () => {
    const issue = normalizeFromIssuePayload({
      project: "billing-api",
      title: "Add invoice export endpoint",
      body: "Expose CSV export for monthly invoices with role-based access control.",
      labels: ["api", "security"],
      externalId: "GH-123",
    });
    const cli = normalizeFromCliPrompt({
      project: "billing-api",
      idea: "Add invoice export endpoint\n\nExpose CSV export for monthly invoices with role-based access control.",
      constraints: [],
      targetUsers: [],
      sourceType: "cli-prompt",
    });

    expect(issue.source.type).toBe("issue");
    expect(issue.source.externalId).toBe("GH-123");
    expect(issue.project).toBe(cli.project);
    expect(issue.request.description).toContain("invoice export");
  });

  it("writes intake artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dexter-intake-"));
    const brief = normalizeFromCliPrompt({
      project: "sample-app",
      idea: "Build a production-ready internal tools API with policy-gated autonomy.",
      constraints: ["self-hosted"],
      targetUsers: ["platform-team"],
    });

    const result = await writeIntakeArtifact(rootDir, brief);
    expect(await fs.pathExists(result.jsonPath)).toBe(true);
    expect(await fs.pathExists(result.markdownPath)).toBe(true);

    const saved = await fs.readJson(result.jsonPath);
    expect(saved.project).toBe("sample-app");
    expect(saved.summary.length).toBeGreaterThan(10);
  });
});
